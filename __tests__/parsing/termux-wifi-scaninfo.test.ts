import { expect, test } from "vitest";
import fs from "fs";
import path from "path";
import { parseTermuxWifiScanInfo } from "../../src/lib/wifiScanner-termux";

test("parses and normalizes Termux Wi-Fi scan results", () => {
  const fixture = fs.readFileSync(
    path.join(__dirname, "../data/termux-wifi-scaninfo.json"),
    "utf-8",
  );

  const results = parseTermuxWifiScanInfo(fixture);

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
