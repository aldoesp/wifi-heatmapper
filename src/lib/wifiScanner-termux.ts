import {
  PartialHeatmapSettings,
  WifiActions,
  WifiResults,
  WifiScanResults,
} from "./types";
import { execAsync } from "./server-utils";
import { GatewayPingResults } from "./types";
import { measureGatewayPing } from "./wifiScanner-ping";
import {
  bySignalStrength,
  channelToBand,
  getDefaultWifiResults,
  isValidMacAddress,
  normalizeMacAddress,
  rssiToPercentage,
} from "./utils";
import { frequencyToChannel } from "./wifiScanner-linux";

interface TermuxWifiScanRecord {
  ssid?: unknown;
  bssid?: unknown;
  rssi?: unknown;
  frequency_mhz?: unknown;
  center_frequency_mhz?: unknown;
  channel_bandwidth_mhz?: unknown;
  capabilities?: unknown;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function securityFromCapabilities(capabilities: unknown): string {
  if (typeof capabilities !== "string") return "";
  if (capabilities.includes("WPA3") || capabilities.includes("SAE")) {
    return capabilities.includes("WPA2") ? "WPA2 WPA3" : "WPA3";
  }
  if (capabilities.includes("WPA2") || capabilities.includes("RSN")) {
    return "WPA2";
  }
  if (capabilities.includes("WPA")) return "WPA";
  if (capabilities.includes("WEP")) return "WEP";
  return capabilities.includes("ESS") ? "Open" : "";
}

function parseRecords(input: unknown): TermuxWifiScanRecord[] {
  let value = input;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return [];
    }
  }
  if (Array.isArray(value)) return value as TermuxWifiScanRecord[];
  if (value && typeof value === "object") {
    return [value as TermuxWifiScanRecord];
  }
  return [];
}

export function parseAndroidTxLinkSpeed(input: unknown): number | null {
  let value = input;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== "object" || !("txLinkSpeedMbps" in value)) {
    return null;
  }
  const speed = asNumber(value.txLinkSpeedMbps);
  return speed !== null && speed > 0 ? speed : null;
}

async function readAndroidTxLinkSpeed(): Promise<number | null> {
  try {
    const response = await fetch("http://127.0.0.1:8765/tx-link-speed", {
      signal: AbortSignal.timeout(500),
    });
    return response.ok ? parseAndroidTxLinkSpeed(await response.json()) : null;
  } catch {
    return null;
  }
}

export function parseTermuxWifiScanInfo(
  input: unknown,
  keepMissingBssid = false,
): WifiResults[] {
  return parseRecords(input)
    .flatMap((record) => {
      const bssid = typeof record.bssid === "string" ? record.bssid : "";
      const normalizedBssid = isValidMacAddress(bssid)
        ? normalizeMacAddress(bssid)
        : "";
      const realBssid =
        normalizedBssid && normalizedBssid !== "020000000000"
          ? normalizedBssid
          : "";
      const rssi = asNumber(record.rssi);
      const frequencyMhz = asNumber(record.frequency_mhz);
      const centerFrequencyMhz = asNumber(record.center_frequency_mhz);
      if ((!realBssid && !keepMissingBssid) || rssi === null) return [];

      const channel =
        frequencyMhz === null ? 0 : (frequencyToChannel(frequencyMhz) ?? 0);
      const result: WifiResults = {
        ...getDefaultWifiResults(),
        ssid: typeof record.ssid === "string" ? record.ssid : "",
        bssid: realBssid,
        rssi,
        signalStrength: rssiToPercentage(rssi),
        channel,
        band: channel === 0 ? 0 : channelToBand(channel),
        channelWidth: asNumber(record.channel_bandwidth_mhz) ?? 0,
        security: securityFromCapabilities(record.capabilities),
        ...(frequencyMhz === null ? {} : { frequencyMhz }),
        ...(centerFrequencyMhz === null ? {} : { centerFrequencyMhz }),
      };
      return [result];
    })
    .sort(bySignalStrength);
}

function unsupported(reason: string): WifiScanResults {
  return { SSIDs: [], reason };
}

export class TermuxWifiActions implements WifiActions {
  async preflightSettings(
    _settings: PartialHeatmapSettings,
  ): Promise<WifiScanResults> {
    try {
      await execAsync("command -v termux-wifi-scaninfo");
      return { SSIDs: [], reason: "" };
    } catch {
      return unsupported(
        "termux-wifi-scaninfo is unavailable. Install Termux:API and the termux-api package.",
      );
    }
  }

  async checkIperfServer(
    _settings: PartialHeatmapSettings,
  ): Promise<WifiScanResults> {
    return unsupported("iperf3 is not supported by the Termux Wi-Fi scanner.");
  }

  async scanWifi(_settings: PartialHeatmapSettings): Promise<WifiScanResults> {
    try {
      const { stdout } = await execAsync("termux-wifi-scaninfo");
      const SSIDs = parseTermuxWifiScanInfo(stdout);
      return {
        SSIDs,
        reason: SSIDs.length === 0 ? "No Wi-Fi networks found." : "",
      };
    } catch (error) {
      return unsupported(`Cannot scan Wi-Fi with Termux:API: ${error}`);
    }
  }

  async setWifi(
    _settings: PartialHeatmapSettings,
    _bestSSID: WifiResults,
  ): Promise<WifiScanResults> {
    return unsupported(
      "The Termux Wi-Fi scanner does not change Wi-Fi networks.",
    );
  }

  async getWifi(_settings: PartialHeatmapSettings): Promise<WifiScanResults> {
    try {
      const { stdout } = await execAsync("termux-wifi-connectioninfo");
      const [current] = parseTermuxWifiScanInfo(stdout, true);
      if (!current) return unsupported("No active Wi-Fi connection found.");
      current.currentSSID = true;
      current.txRate = (await readAndroidTxLinkSpeed()) ?? current.txRate;
      return {
        SSIDs: [current],
        reason: "",
        ...(current.bssid
          ? {}
          : {
              warning:
                "Android did not provide a real Wi-Fi BSSID. This measurement cannot be assigned to an access point.",
            }),
      };
    } catch (error) {
      return unsupported(`Cannot read the current Wi-Fi connection: ${error}`);
    }
  }

  async measureGateway(): Promise<GatewayPingResults> {
    return measureGatewayPing("termux");
  }
}
