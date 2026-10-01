"use client";
import { useEffect, useRef, useState } from "react";
import { Check, CircleAlert, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { SSEMessageType } from "@/app/api/events/route";
import type { IperfResults, WifiResults } from "@/lib/types";
import { formatMacAddress, toMbps } from "@/lib/utils";
import { cn } from "@/lib/utils";

/** Full measurement data, available once the run finished successfully. */
interface MeasurementResult {
  wifiData: WifiResults;
  iperfData: IperfResults;
}

interface MeasurementPanelProps {
  /** Called once the SSE channel is open; start the measurement then. */
  onReady: () => void;
  /** Called when the panel wants to go away (discarded, cancelled, dismissed). */
  onClose: () => void;
  /** Called when the user cancels. */
  onCancel: () => void;
  /** Called when the user validates the reviewed measurement. */
  onConfirm: () => void;
  /** The measured values to review before they are stored. */
  result?: MeasurementResult | null;
  /** Friendly name of the access point, from the survey's AP mapping. */
  apName?: string | null;
  /** Optional error from the results poll (shown instead of progress). */
  error?: string | null;
}

type Phase =
  | "connecting"
  | "running"
  | "done"
  | "warning"
  | "cancelled"
  | "error";

/**
 * Progress of one measurement, anchored to the bottom-right corner.
 * Listens to the server's event stream (/api/events) for updates.
 * When the measurement completes, the values are shown in a scrollable
 * review area; the point is only stored after the user saves it.
 */
export default function MeasurementPanel({
  onReady,
  onClose,
  onCancel,
  onConfirm,
  result,
  apName,
  error,
}: MeasurementPanelProps) {
  const [phase, setPhase] = useState<Phase>("connecting");
  const [header, setHeader] = useState("Connecting");
  const [fields, setFields] = useState({ strength: "-", tcp: "-", udp: "-" });
  const [message, setMessage] = useState("");
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  useEffect(() => {
    const es = new EventSource("/api/events");

    es.onmessage = (event: MessageEvent) => {
      let data: SSEMessageType;
      try {
        data = JSON.parse(event.data);
      } catch {
        return;
      }
      if (data.type === "heartbeat") return;
      if (data.type === "ready") {
        setPhase("running");
        setHeader("Starting");
        onReadyRef.current();
        return;
      }
      if (data.fields) setFields(data.fields);
      setHeader(data.header);
      if (data.type === "update") return;
      if (data.type === "done") {
        es.close();
        const failed = /error|cancel/i.test(data.header);
        if (failed) {
          setPhase(/cancel/i.test(data.header) ? "cancelled" : "error");
          setMessage(data.status);
        } else {
          setPhase(data.status ? "warning" : "done");
          if (data.status) setMessage(data.status);
        }
      }
    };

    es.onerror = () => {
      es.close();
      setPhase((p) => (p === "connecting" ? "error" : p));
      setMessage(
        (m) => m || "Lost contact with the server. Is it still running?",
      );
    };

    return () => es.close();
  }, []);

  // An error surfaced by the results poll wins over whatever the stream said
  useEffect(() => {
    if (error) {
      setPhase("error");
      setMessage(error);
    }
  }, [error]);

  const cancel = async () => {
    setPhase("cancelled");
    setHeader("Cancelled");
    onCancel();
    await fetch("/api/start-task?action=stop", { method: "POST" }).catch(
      () => {},
    );
  };

  const running = phase === "connecting" || phase === "running";
  const reviewing = (phase === "done" || phase === "warning") && !!result;

  return (
    <aside
      role="status"
      aria-live="polite"
      data-testid="measurement-panel"
      data-phase={phase}
      className={cn(
        "fixed bottom-4 right-4 z-40 w-[min(24rem,calc(100vw-2rem))] rounded-lg border bg-popover text-popover-foreground shadow-float",
        "animate-in slide-in-from-bottom-2 fade-in-0 duration-200",
      )}
    >
      <div className="flex items-center gap-2.5 border-b px-4 py-3">
        {running && (
          <span className="measuring-dot h-2.5 w-2.5 shrink-0 rounded-full bg-brand" />
        )}
        {(phase === "done" || phase === "warning") && (
          <Check className="h-4 w-4 shrink-0 text-success" />
        )}
        {(phase === "error" || phase === "cancelled") && (
          <CircleAlert className="h-4 w-4 shrink-0 text-destructive" />
        )}
        <h3 className="truncate text-sm font-semibold">
          {phase === "done" || phase === "warning"
            ? "Measurement complete"
            : header}
        </h3>
        {!running && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Dismiss"
            className="ml-auto rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {phase === "error" || phase === "cancelled" ? (
        <p className="whitespace-pre-line px-4 py-3 text-sm">{message}</p>
      ) : reviewing ? (
        <>
          {phase === "warning" && message && (
            <p className="border-b px-4 py-2.5 text-sm text-warning">
              {message}
            </p>
          )}
          <ReviewDetails
            result={result}
            apName={apName}
            noIperfReason={{
              tcp: fields.tcp,
              udp: fields.udp,
            }}
          />
          <div className="flex items-center justify-end gap-2 border-t px-4 py-2.5">
            <Button
              size="sm"
              variant="outline"
              onClick={onClose}
              data-testid="measurement-discard"
            >
              Discard
            </Button>
            <Button
              size="sm"
              variant="brand"
              onClick={onConfirm}
              data-testid="measurement-save"
            >
              Save point
            </Button>
          </div>
        </>
      ) : (
        <dl className="tabular grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 px-4 py-3 text-sm">
          <dt className="text-muted-foreground">Signal</dt>
          <dd className="text-right font-medium">{fields.strength}</dd>
          <dt className="text-muted-foreground">TCP down / up</dt>
          <dd className="truncate text-right font-medium">{fields.tcp}</dd>
          <dt className="text-muted-foreground">UDP down / up</dt>
          <dd className="truncate text-right font-medium">{fields.udp}</dd>
        </dl>
      )}

      {running && (
        <div className="flex items-center justify-between border-t px-4 py-2.5">
          <span className="text-xs text-muted-foreground">
            Stay where you are until it finishes.
          </span>
          <Button
            size="sm"
            variant="outline"
            onClick={cancel}
            data-testid="measurement-cancel"
          >
            Cancel
          </Button>
        </div>
      )}
    </aside>
  );
}

/**
 * The measured values, readable and scrollable, shown for review
 * before the point is stored.
 */
function ReviewDetails({
  result,
  apName,
  noIperfReason,
}: {
  result: MeasurementResult;
  apName?: string | null;
  /** Last progress strings; carry the reason when iperf was not run. */
  noIperfReason: { tcp: string; udp: string };
}) {
  const { wifiData: wifi, iperfData: iperf } = result;

  const mbps = (bps: number) => `${toMbps(bps)} Mbps`;
  const hasTcp =
    iperf.tcpDownload.bitsPerSecond > 0 || iperf.tcpUpload.bitsPerSecond > 0;
  const hasUdp =
    iperf.udpDownload.bitsPerSecond > 0 || iperf.udpUpload.bitsPerSecond > 0;
  const hasIperf = hasTcp || hasUdp;

  const lossPercent = (t: IperfResults["udpDownload"]): string => {
    const { lostPackets, packetsReceived } = t;
    if (lostPackets == null) return "-";
    const total = (packetsReceived ?? 0) + lostPackets;
    if (total === 0) return "-";
    return `${((lostPackets / total) * 100).toFixed(2)}%`;
  };

  const rows: [string, React.ReactNode][] = [
    [
      "Signal",
      `${Math.round(wifi.signalStrength)}% (${Math.round(wifi.rssi)} dBm)`,
    ],
    ["Network", wifi.ssid || "not available"],
    [
      "Access point",
      apName || formatMacAddress(wifi.bssid || "") || "not available",
    ],
    [
      "Channel",
      wifi.channel ? `${wifi.channel} (${wifi.band} GHz)` : "not available",
    ],
  ];
  if (wifi.phyMode) {
    rows.push([
      "Mode",
      wifi.channelWidth
        ? `${wifi.phyMode}, ${wifi.channelWidth} MHz`
        : wifi.phyMode,
    ]);
  }
  if (wifi.txRate > 0) {
    rows.push(["Link rate", `${wifi.txRate} Mbps`]);
  }
  if (wifi.security) {
    rows.push(["Security", wifi.security]);
  }
  if (hasIperf) {
    if (hasTcp) {
      rows.push([
        "TCP down / up",
        `${mbps(iperf.tcpDownload.bitsPerSecond)} / ${mbps(iperf.tcpUpload.bitsPerSecond)}`,
      ]);
      rows.push([
        "TCP retransmits",
        `${iperf.tcpDownload.retransmits ?? 0} / ${iperf.tcpUpload.retransmits ?? 0}`,
      ]);
    } else {
      rows.push(["TCP down / up", noIperfReason.tcp || "not measured"]);
    }
    if (hasUdp) {
      rows.push([
        "UDP down / up",
        `${mbps(iperf.udpDownload.bitsPerSecond)} / ${mbps(iperf.udpUpload.bitsPerSecond)}`,
      ]);
      rows.push([
        "UDP jitter",
        `${iperf.udpDownload.jitterMs?.toFixed(3) ?? "-"} / ${iperf.udpUpload.jitterMs?.toFixed(3) ?? "-"} ms`,
      ]);
      rows.push([
        "UDP loss",
        `${lossPercent(iperf.udpDownload)} / ${lossPercent(iperf.udpUpload)}`,
      ]);
    } else {
      rows.push(["UDP down / up", noIperfReason.udp || "not measured"]);
    }
  } else {
    rows.push(["Throughput", noIperfReason.tcp || "not measured"]);
  }

  return (
    <div
      className="tabular max-h-[45vh] overflow-y-auto overscroll-contain px-4 py-3"
      data-testid="measurement-review"
    >
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="break-words text-right font-medium">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
