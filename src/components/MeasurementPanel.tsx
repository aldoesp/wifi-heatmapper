"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, CircleAlert, ScanLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { SSEMessageType } from "@/app/api/events/route";
import type { IperfResults, WifiResults } from "@/lib/types";
import { formatMacAddress, toMbps, cn } from "@/lib/utils";

/** Full measurement data, available once the run finished successfully. */
interface MeasurementResult {
  wifiData: WifiResults;
  iperfData: IperfResults;
  networks?: WifiResults[];
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
  /** Every network seen during the scan, strongest first. */
  networks?: WifiResults[];
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
 * One measurement, shown in a centred dialog: live progress while it runs,
 * then a scrollable review with one card per detected network. The point is
 * only stored after the user saves it.
 */
export default function MeasurementPanel({
  onReady,
  onClose,
  onCancel,
  onConfirm,
  result,
  networks,
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
  const title =
    phase === "done" || phase === "warning"
      ? "Measurement complete"
      : phase === "cancelled" || phase === "error"
        ? header
        : header;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        // A running measurement cannot be dismissed from here, only cancelled
        if (!open && !running) onClose();
      }}
    >
      <DialogContent
        data-testid="measurement-panel"
        data-phase={phase}
        aria-describedby={undefined}
        className="flex max-h-[85vh] w-[min(720px,92vw)] max-w-none flex-col gap-0 overflow-hidden rounded-xl p-0"
        onInteractOutside={(e) => running && e.preventDefault()}
        onEscapeKeyDown={(e) => running && e.preventDefault()}
      >
        <DialogHeader className="flex-row items-center gap-2.5 space-y-0 border-b bg-muted px-5 py-3.5">
          {running && (
            <span className="measuring-dot h-2.5 w-2.5 shrink-0 rounded-full bg-brand" />
          )}
          {(phase === "done" || phase === "warning") && (
            <Check className="h-4 w-4 shrink-0 text-success" />
          )}
          {(phase === "error" || phase === "cancelled") && (
            <CircleAlert className="h-4 w-4 shrink-0 text-destructive" />
          )}
          <DialogTitle className="truncate text-base">{title}</DialogTitle>
          {!running && (
            <span className="tabular ml-auto mr-6 shrink-0 text-xs text-muted-foreground">
              {reviewing ? "Review the values, then validate" : ""}
            </span>
          )}
        </DialogHeader>

        {phase === "warning" && message && (
          <p className="border-b bg-warning/10 px-5 py-2.5 text-sm text-warning">
            {message}
          </p>
        )}

        {phase === "error" || phase === "cancelled" ? (
          <p className="whitespace-pre-line px-5 py-4 text-sm">{message}</p>
        ) : reviewing ? (
          <div
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4"
            data-testid="measurement-review"
          >
            {result && (
              <NetworkCard
                wifi={result.wifiData}
                apName={apName}
                iperf={result.iperfData}
                noIperfReason={{ tcp: fields.tcp, udp: fields.udp }}
                isMeasured
              />
            )}

            {networks && networks.length > 0 && (
              <>
                <h4 className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Networks detected ({networks.length})
                </h4>
                <div className="grid gap-2.5">
                  {networks.map((wifi, i) => (
                    <NetworkCard
                      key={`${wifi.bssid}-${i}`}
                      wifi={wifi}
                      isCurrent={wifi.bssid === result.wifiData.bssid}
                    />
                  ))}
                </div>
              </>
            )}
          </div>
        ) : (
          <dl className="tabular grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 px-5 py-4 text-sm">
            <dt className="text-muted-foreground">Signal</dt>
            <dd className="text-right font-medium">{fields.strength}</dd>
            <dt className="text-muted-foreground">TCP down / up</dt>
            <dd className="truncate text-right font-medium">{fields.tcp}</dd>
            <dt className="text-muted-foreground">UDP down / up</dt>
            <dd className="truncate text-right font-medium">{fields.udp}</dd>
          </dl>
        )}

        <div className="flex items-center justify-between gap-3 border-t px-5 py-3">
          {running ? (
            <>
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
            </>
          ) : reviewing ? (
            <div className="ml-auto flex gap-2">
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
          ) : (
            <span />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ── signal strength visuals ──────────────────────────────────────────── */

type SignalTone = "good" | "medium" | "weak";

const toneStyles: Record<
  SignalTone,
  { edge: string; bar: string; text: string }
> = {
  good: { edge: "border-l-success", bar: "bg-success", text: "text-success" },
  medium: {
    edge: "border-l-warning",
    bar: "bg-warning",
    text: "text-warning",
  },
  weak: {
    edge: "border-l-destructive",
    bar: "bg-destructive",
    text: "text-destructive",
  },
};

/** RSSI to a level, a label and a 0-100 percent for the bar. */
function signalLevel(rssi: number): {
  tone: SignalTone;
  label: string;
  pct: number;
} {
  const pct = Math.max(0, Math.min(100, 2 * (rssi + 100)));
  if (rssi >= -60) return { tone: "good", label: "Strong", pct };
  if (rssi >= -75) return { tone: "medium", label: "Fair", pct };
  return { tone: "weak", label: "Weak", pct };
}

function SignalBar({ pct, tone }: { pct: number; tone: SignalTone }) {
  return (
    <span
      className="ml-2 inline-block h-2 w-20 overflow-hidden rounded-full bg-muted align-middle"
      aria-hidden="true"
    >
      <span
        className={cn("block h-full", toneStyles[tone].bar)}
        style={{ width: `${pct}%` }}
      />
    </span>
  );
}

/* ── cards ────────────────────────────────────────────────────────────── */

function DetailRows({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="tabular mt-1.5 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-xs">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="break-words text-right">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * One detected network as a card, colour-coded by signal strength,
 * with a bar. With `iperf` set it becomes the measured-point card and
 * also shows the throughput results.
 */
function NetworkCard({
  wifi,
  apName,
  iperf,
  noIperfReason,
  isMeasured,
  isCurrent,
}: {
  wifi: WifiResults;
  apName?: string | null;
  iperf?: IperfResults;
  /** Progress strings carrying the reason when iperf was not run. */
  noIperfReason?: { tcp: string; udp: string };
  isMeasured?: boolean;
  isCurrent?: boolean;
}) {
  const level = signalLevel(wifi.rssi);
  const tone = toneStyles[level.tone];

  const rows: [string, ReactNode][] = [
    [
      "Signal",
      <>
        {Math.round(wifi.rssi)} dBm — {level.label}
        <SignalBar pct={level.pct} tone={level.tone} />
      </>,
    ],
    ["BSSID", formatMacAddress(wifi.bssid || "") || "not available"],
    [
      "Frequency",
      wifi.frequencyMhz ? `${wifi.frequencyMhz} MHz` : `${wifi.band} GHz band`,
    ],
    ["Width", wifi.channelWidth ? `${wifi.channelWidth} MHz` : "not available"],
  ];
  if (wifi.centerFrequencyMhz) {
    rows.push(["Centre", `${wifi.centerFrequencyMhz} MHz`]);
  }
  if (wifi.security) {
    rows.push(["Security", wifi.security]);
  }

  if (isMeasured && iperf) {
    rows.unshift(
      [
        "Quality",
        <span className="font-medium" key="q">
          {Math.round(wifi.signalStrength)}% ({Math.round(wifi.rssi)} dBm)
        </span>,
      ],
      [
        "Network",
        wifi.ssid || (
          <span className="italic text-muted-foreground">hidden SSID</span>
        ),
      ],
      ["Access point", apName || formatMacAddress(wifi.bssid || "") || "n/a"],
      [
        "Channel",
        wifi.channel ? `${wifi.channel} (${wifi.band} GHz)` : "not available",
      ],
    );
    if (wifi.phyMode) rows.push(["Mode", wifi.phyMode]);
    if (wifi.txRate > 0) rows.push(["Link rate", `${wifi.txRate} Mbps`]);

    const hasTcp =
      iperf.tcpDownload.bitsPerSecond > 0 || iperf.tcpUpload.bitsPerSecond > 0;
    const hasUdp =
      iperf.udpDownload.bitsPerSecond > 0 || iperf.udpUpload.bitsPerSecond > 0;
    if (hasTcp || hasUdp) {
      if (hasTcp) {
        rows.push(
          [
            "TCP down / up",
            `${toMbps(iperf.tcpDownload.bitsPerSecond)} / ${toMbps(iperf.tcpUpload.bitsPerSecond)} Mbps`,
          ],
          [
            "TCP retransmits",
            `${iperf.tcpDownload.retransmits ?? 0} / ${iperf.tcpUpload.retransmits ?? 0}`,
          ],
        );
      } else {
        rows.push(["TCP down / up", noIperfReason?.tcp || "not measured"]);
      }
      if (hasUdp) {
        const lossPct = (t: IperfResults["udpDownload"]) => {
          const { lostPackets, packetsReceived } = t;
          if (lostPackets == null) return "-";
          const total = (packetsReceived ?? 0) + lostPackets;
          return total === 0
            ? "-"
            : `${((lostPackets / total) * 100).toFixed(2)}%`;
        };
        rows.push(
          [
            "UDP down / up",
            `${toMbps(iperf.udpDownload.bitsPerSecond)} / ${toMbps(iperf.udpUpload.bitsPerSecond)} Mbps`,
          ],
          [
            "UDP jitter",
            `${iperf.udpDownload.jitterMs?.toFixed(3) ?? "-"} / ${iperf.udpUpload.jitterMs?.toFixed(3) ?? "-"} ms`,
          ],
          [
            "UDP loss",
            `${lossPct(iperf.udpDownload)} / ${lossPct(iperf.udpUpload)}`,
          ],
        );
      } else {
        rows.push(["UDP down / up", noIperfReason?.udp || "not measured"]);
      }
    } else {
      rows.push(["Throughput", noIperfReason?.tcp || "not measured"]);
    }
  }

  return (
    <article
      className={cn(
        "rounded-lg border border-l-4 bg-muted/30 px-3.5 py-3",
        tone.edge,
      )}
      data-testid={isMeasured ? "measurement-point-card" : undefined}
    >
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        {isMeasured ? (
          <ScanLine className="h-4 w-4 shrink-0 text-muted-foreground" />
        ) : null}
        <span className="truncate">
          {wifi.ssid || (
            <span className="font-normal italic text-muted-foreground">
              (hidden SSID)
            </span>
          )}
        </span>
        {isMeasured && (
          <span className="rounded-full bg-brand/15 px-2 py-0.5 text-[11px] font-medium text-brand">
            Measured point
          </span>
        )}
        {isCurrent && !isMeasured && (
          <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
            In use
          </span>
        )}
        <span
          className={cn(
            "tabular ml-auto shrink-0 text-xs font-medium",
            tone.text,
          )}
        >
          {level.label}
        </span>
      </h3>
      <DetailRows rows={rows} />
    </article>
  );
}
