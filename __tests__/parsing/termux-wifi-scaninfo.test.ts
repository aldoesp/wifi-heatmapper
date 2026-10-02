import { expect, test, vi } from "vitest";
import fs from "fs";
import path from "path";
import * as serverUtils from "../../src/lib/server-utils";
import type { PartialHeatmapSettings } from "../../src/lib/types";
import {
  parseTermuxWifiScanInfo,
  TermuxWifiActions,
} from "../../src/lib/wifiScanner-termux";

test("parses and normalizes Termux Wi-Fi scan results", () => {
  const fixture = fs.readFileSync(
    path.join(__dirname, "../data/termux-wifi-scaninfo.json"),
    "utf-8",
  );

  const results = parseTermuxWifiScanInfo(fixture);
  console.log("Parsed Termux Wi-Fi results:", JSON.stringify(results, null, 2));

  expect(results).toHaveLength(8);
  expect(results[0]).toMatchObject({
    ssid: "ZMTL_GUEST",
    bssid: "9a3066745083",
    rssi: -44,
    signalStrength: 93,
    channel: 40,
    band: 5,
    channelWidth: 80,
    security: "WPA2 WPA3",
    frequencyMhz: 5200,
    centerFrequencyMhz: 5210,
  });
  expect(results.at(-1)).toMatchObject({
    rssi: -85,
    signalStrength: 25,
    channel: 128,
    frequencyMhz: 5640,
    centerFrequencyMhz: 5610,
  });
});

test("keeps hidden SSIDs and supports missing optional fields", () => {
  const [hidden] = parseTermuxWifiScanInfo([
    {
      bssid: "AA-BB-CC-DD-EE-FF",
      rssi: "-60",
      frequency_mhz: 2412,
      capabilities: "[ESS]",
    },
  ]);

  expect(hidden).toMatchObject({
    ssid: "",
    bssid: "aabbccddeeff",
    rssi: -60,
    signalStrength: 67,
    channel: 1,
    band: 2.4,
    channelWidth: 0,
    security: "Open",
  });
  expect(hidden).not.toHaveProperty("centerFrequencyMhz");
});

test("ignores records without a BSSID or numeric RSSI", () => {
  const results = parseTermuxWifiScanInfo([
    { ssid: "missing bssid", rssi: -40 },
    { bssid: "00:11:22:33:44:55", rssi: "unknown" },
  ]);

  expect(results).toEqual([]);
});

test("recognizes Android's placeholder BSSID as unavailable", () => {
  const connection = {
    ssid: "Connected network",
    bssid: "02:00:00:00:00:00",
    rssi: -48,
  };

  expect(parseTermuxWifiScanInfo(connection)).toEqual([]);
  expect(parseTermuxWifiScanInfo(connection, true)[0]).toMatchObject({
    ssid: "Connected network",
    bssid: "",
    rssi: -48,
  });
});

test("warns when the connected Wi-Fi has no real BSSID", async () => {
  // the scan returns nothing: getWifi falls back to the connection info
  vi.spyOn(serverUtils, "execAsync").mockImplementation(async (cmd) => {
    if (String(cmd).includes("scaninfo")) return { stdout: "[]", stderr: "" };
    return {
      stdout: JSON.stringify({
        ssid: "Connected network",
        bssid: "02:00:00:00:00:00",
        rssi: -48,
      }),
      stderr: "",
    };
  });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));

  try {
    const result = await new TermuxWifiActions().getWifi(
      {} as PartialHeatmapSettings,
    );

    expect(result.SSIDs[0]).toMatchObject({
      ssid: "Connected network",
      bssid: "",
      rssi: -48,
    });
    expect(result.warning).toContain("did not provide a real Wi-Fi BSSID");
    expect(result.reason).toBe("");
  } finally {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});

test("getWifi takes the connected network from the scan, with rich fields", async () => {
  const scanFixture = fs.readFileSync(
    path.join(__dirname, "../data/termux-wifi-scaninfo.json"),
    "utf-8",
  );
  vi.spyOn(serverUtils, "execAsync").mockImplementation(async (cmd) => {
    if (String(cmd).includes("connectioninfo")) {
      // only ssid/bssid/rssi: the point of the scan is to add the rest
      return {
        stdout: JSON.stringify({
          ssid: "ZMTL_GUEST",
          bssid: "9a:30:66:74:50:83",
          rssi: -46,
        }),
        stderr: "",
      };
    }
    return { stdout: scanFixture, stderr: "" };
  });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));

  try {
    const result = await new TermuxWifiActions().getWifi(
      {} as PartialHeatmapSettings,
    );

    expect(result.SSIDs[0]).toMatchObject({
      ssid: "ZMTL_GUEST",
      bssid: "9a3066745083",
      currentSSID: true,
      // these come from the scan record, not from the connection info
      channelWidth: 80,
      security: "WPA2 WPA3",
      centerFrequencyMhz: 5210,
    });
  } finally {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});

test("parses the single object returned by termux-wifi-connectioninfo", () => {
  const [current] = parseTermuxWifiScanInfo({
    ssid: "ZMTL_GUEST",
    bssid: "9a:30:66:74:50:83",
    rssi: -46,
    frequency_mhz: 5200,
    channel_bandwidth_mhz: "80",
    center_frequency_mhz: 5210,
    capabilities: "[WPA2-PSK-CCMP][RSN-PSK+SAE-CCMP][ESS]",
  });

  expect(current).toMatchObject({
    ssid: "ZMTL_GUEST",
    bssid: "9a3066745083",
    rssi: -46,
    channel: 40,
    band: 5,
    frequencyMhz: 5200,
    centerFrequencyMhz: 5210,
  });
});
