import { execFile } from "child_process";
import { isIP } from "net";
import { GatewayPingResults } from "./types";

export type GatewayPingPlatform = "linux" | "macos" | "windows" | "termux";

const PROBE_COUNT = 5;

function run(command: string, args: string[], timeout: number) {
  return new Promise<{ stdout: string; stderr: string; error: string | null }>(
    (resolve) => {
      execFile(command, args, { timeout, encoding: "utf8" }, (error, stdout, stderr) => {
        resolve({
          stdout: String(stdout ?? ""),
          stderr: String(stderr ?? ""),
          error: error?.message ?? null,
        });
      });
    },
  );
}

export function parseDefaultGateway(
  output: string,
  platform: GatewayPingPlatform,
): string | null {
  const match =
    platform === "macos"
      ? output.match(/gateway:\s*(\S+)/i)
      : platform === "windows"
        ? output.match(/(?:^|\s)(\d{1,3}(?:\.\d{1,3}){3})(?:\s|$)/)
        : output.match(/\bdefault\s+via\s+(\d{1,3}(?:\.\d{1,3}){3})\b/);
  const gatewayIp = match?.[1]?.trim();
  return gatewayIp && isIP(gatewayIp) === 4 ? gatewayIp : null;
}

export function parseGatewayPingOutput(
  output: string,
  gatewayIp: string,
  probesSent = PROBE_COUNT,
): GatewayPingResults | null {
  const samples = [
    ...output.matchAll(
      /(?:time|temps|zeit|tiempo|tempo)\s*([=<])?\s*(\d+(?:[.,]\d+)?)\s*ms/gi,
    ),
  ].map((match) => {
    const time = Number(match[2].replace(",", "."));
    return match[1] === "<" ? time / 2 : time;
  });
  const lossMatch =
    output.match(
      /(\d+(?:[.,]\d+)?)%\s*(?:packet\s*loss|loss|(?:de\s+)?perte|verlust|pérdida)/i,
    ) ??
    output.match(
      /(?:loss|perte|verlust|pérdida)\s*[=:]\s*(\d+(?:[.,]\d+)?)\s*%/i,
    );
  if (samples.length === 0 && !lossMatch) return null;

  const sorted = [...samples].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return {
    gatewayIp,
    medianRttMs:
      sorted.length === 0
        ? null
        : sorted.length % 2 === 0
          ? (sorted[mid - 1] + sorted[mid]) / 2
          : sorted[mid],
    packetLossPercent: lossMatch
      ? Number(lossMatch[1].replace(",", "."))
      : ((probesSent - samples.length) / probesSent) * 100,
    probesSent,
    probesReceived: samples.length,
  };
}

function routeCommand(platform: GatewayPingPlatform) {
  if (platform === "macos") {
    return { command: "route", args: ["-n", "get", "default"] };
  }
  if (platform === "windows") {
    return {
      command: "powershell.exe",
      args: [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "Get-NetRoute -AddressFamily IPv4 -DestinationPrefix '0.0.0.0/0' | Sort-Object { $_.RouteMetric + $_.InterfaceMetric } | Select-Object -First 1 -ExpandProperty NextHop",
      ],
    };
  }
  return { command: "ip", args: ["-4", "route", "show", "default"] };
}

export async function measureGatewayPing(
  platform: GatewayPingPlatform,
): Promise<GatewayPingResults> {
  const route = routeCommand(platform);
  const routeResult = await run(route.command, route.args, 2000);
  const gatewayIp = parseDefaultGateway(routeResult.stdout, platform);
  if (!gatewayIp) {
    return {
      gatewayIp: null,
      medianRttMs: null,
      packetLossPercent: null,
      probesSent: 0,
      probesReceived: 0,
      error: routeResult.error ?? "No IPv4 default gateway found.",
    };
  }

  const ping =
    platform === "windows"
      ? {
          command: "ping.exe",
          args: ["-n", String(PROBE_COUNT), "-w", "1000", gatewayIp],
        }
      : { command: "ping", args: ["-n", "-c", String(PROBE_COUNT), gatewayIp] };
  const result = await run(ping.command, ping.args, 7000);
  const parsed = parseGatewayPingOutput(
    `${result.stdout}\n${result.stderr}`,
    gatewayIp,
  );
  return (
    parsed ?? {
      gatewayIp,
      medianRttMs: null,
      packetLossPercent: null,
      probesSent: 0,
      probesReceived: 0,
      error: result.error ?? "Could not parse ping results.",
    }
  );
}