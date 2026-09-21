"use client";

import * as Tabs from "@radix-ui/react-tabs";
import { useCallback, useEffect, useState } from "react";
import {
  FlaskConical,
  Github,
  ListChecks,
  Map,
  ScanLine,
  Settings2,
} from "lucide-react";

import { useSettings } from "@/components/GlobalSettings";
import { useAppStatus } from "@/hooks/useAppStatus";
import { BrandMark } from "./BrandMark";
import { AboutDialog } from "./AboutDialog";
import { SurveySummary } from "./SurveySummary";
import { WelcomePanel } from "./WelcomePanel";
import { ThemeToggle } from "@/components/ThemeToggle";
import SettingsEditor from "@/components/SettingsEditor";
import ClickableFloorplan from "@/components/Floorplan";
import { Heatmaps } from "@/components/Heatmaps";
import PointsTable from "@/components/PointsTable";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const TABS = [
  { id: "settings", label: "Settings", mobileLabel: "Setup", icon: Settings2 },
  { id: "floorplan", label: "Floor plan", mobileLabel: "Scan", icon: ScanLine },
  { id: "heatmaps", label: "Heat maps", mobileLabel: "Map", icon: Map },
  {
    id: "points",
    label: "Survey points",
    mobileLabel: "Points",
    icon: ListChecks,
  },
] as const;
export type TabId = (typeof TABS)[number]["id"];

const isTabId = (v: string): v is TabId => TABS.some((t) => t.id === v);

/** The active tab lives in the URL hash so reload and back/forward keep it. */
function useHashTab(defaultTab: TabId): [TabId, (t: TabId) => void] {
  const [tab, setTab] = useState<TabId>(defaultTab);

  useEffect(() => {
    const read = () => {
      const h = window.location.hash.replace(/^#/, "");
      if (isTabId(h)) setTab(h);
    };
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);

  const select = useCallback((t: TabId) => {
    setTab(t);
    if (window.location.hash !== `#${t}`) {
      history.replaceState(null, "", `#${t}`);
    }
  }, []);

  return [tab, select];
}

export default function AppShell() {
  const [tab, setTab] = useHashTab("settings");
  const { settings, surveyPointActions } = useSettings();
  const status = useAppStatus();

  return (
    <Tabs.Root
      value={tab}
      onValueChange={(v) => isTabId(v) && setTab(v)}
      className="flex min-h-[100dvh] flex-col pb-16 sm:pb-0"
    >
      <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="mx-auto flex max-w-[1440px] flex-wrap items-center gap-x-6 px-4 sm:h-14 sm:flex-nowrap sm:px-6">
          <a
            href="#settings"
            onClick={() => setTab("settings")}
            className="order-1 flex h-14 min-h-11 shrink-0 items-center gap-2 rounded-md text-[15px] font-semibold tracking-tight"
          >
            <BrandMark className="h-6 w-6" />
            <span>Wi-Fi Heatmapper</span>
          </a>

          <Tabs.List
            aria-label="Sections"
            className="order-3 -mx-4 hidden h-11 basis-full items-stretch gap-1 overflow-x-auto px-3 sm:order-2 sm:mx-0 sm:flex sm:h-14 sm:basis-auto sm:px-0"
          >
            {TABS.map((t) => (
              <Tabs.Trigger
                key={t.id}
                value={t.id}
                data-testid={`tab-${t.id}`}
                className={cn(
                  "relative flex items-center whitespace-nowrap px-3 text-sm text-muted-foreground transition-colors",
                  "hover:text-foreground data-[state=active]:text-foreground",
                  "after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:rounded-full after:bg-brand after:opacity-0 after:transition-opacity",
                  "data-[state=active]:after:opacity-100",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset rounded-md",
                )}
              >
                {t.label}
                {t.id === "points" && settings.surveyPoints.length > 0 && (
                  <span className="tabular ml-1.5 rounded-full bg-secondary px-1.5 py-px text-xs text-secondary-foreground">
                    {settings.surveyPoints.length}
                  </span>
                )}
              </Tabs.Trigger>
            ))}
          </Tabs.List>

          <div className="order-2 ml-auto flex items-center gap-1 sm:order-3">
            {status?.mockMode && (
              <span
                className="mr-2 hidden items-center gap-1.5 rounded-full border border-warning/40 bg-warning/10 px-2.5 py-1 text-xs font-medium text-warning sm:inline-flex"
                title="WIFI_HEATMAPPER_MOCK is set: measurements are synthetic"
                data-testid="mock-badge"
              >
                <FlaskConical className="h-3.5 w-3.5" />
                Mock data
              </span>
            )}
            <ThemeToggle />
            <AboutDialog />
            <a
              href="https://github.com/hnykda/wifi-heatmapper"
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-10 w-10 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              aria-label="Source code on GitHub"
              title="GitHub"
            >
              <Github className="h-4 w-4" />
            </a>
          </div>
        </div>
      </header>

      {tab === "settings" && (
        <div className="mx-auto w-full max-w-[1440px] px-4 pt-4 sm:hidden sm:px-6 sm:pt-6">
          <div className="rounded-2xl border border-brand/25 bg-brand-soft/60 p-5 shadow-sm">
            <div className="flex items-start gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand text-brand-foreground">
                <ScanLine className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-base font-semibold">
                  Ready to map your Wi-Fi?
                </p>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                  Open your floor plan, then tap where you are standing to
                  capture a signal reading.
                </p>
              </div>
            </div>
            <Button
              className="mt-4 h-11 w-full rounded-xl"
              variant="brand"
              onClick={() => setTab("floorplan")}
              data-testid="mobile-start-scan"
            >
              <ScanLine className="h-4 w-4" />
              Start a scan
            </Button>
          </div>
        </div>
      )}

      <div className="hidden sm:block">
        <SurveySummary onNavigate={setTab} />
      </div>

      <main className="mx-auto w-full max-w-[1440px] flex-1 px-4 py-5 sm:px-6 sm:py-6">
        <div className="sm:hidden">
          <SurveySummary onNavigate={setTab} />
        </div>
        <div className="hidden sm:block">
          <WelcomePanel />
        </div>
        <Tabs.Content value="settings" className="outline-none">
          <SettingsEditor />
        </Tabs.Content>
        <Tabs.Content value="floorplan" className="outline-none">
          <ClickableFloorplan />
        </Tabs.Content>
        <Tabs.Content value="heatmaps" className="outline-none">
          <Heatmaps />
        </Tabs.Content>
        <Tabs.Content value="points" className="outline-none">
          <PointsTable
            data={settings.surveyPoints}
            surveyPointActions={surveyPointActions}
            apMapping={settings.apMapping}
          />
        </Tabs.Content>
      </main>

      <Tabs.List
        aria-label="Mobile sections"
        className="fixed inset-x-0 bottom-0 z-40 grid h-16 grid-cols-4 border-t bg-surface/95 pb-[env(safe-area-inset-bottom)] shadow-[0_-8px_24px_hsl(var(--foreground)/0.06)] backdrop-blur sm:hidden"
      >
        {TABS.map((t) => {
          const Icon = t.icon;
          return (
            <Tabs.Trigger
              key={`mobile-${t.id}`}
              value={t.id}
              data-testid={`mobile-tab-${t.id}`}
              className="relative flex min-h-11 flex-col items-center justify-center gap-1 px-1 text-[11px] font-medium text-muted-foreground transition-colors data-[state=active]:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
            >
              <Icon className="h-5 w-5" />
              <span>{t.mobileLabel}</span>
              {t.id === "points" && settings.surveyPoints.length > 0 && (
                <span className="absolute right-5 top-2 rounded-full bg-brand px-1.5 text-[10px] text-brand-foreground">
                  {settings.surveyPoints.length}
                </span>
              )}
            </Tabs.Trigger>
          );
        })}
      </Tabs.List>
    </Tabs.Root>
  );
}
