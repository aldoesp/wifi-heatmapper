"use client";
import { useSettings, DEFAULT_FLOORPLAN } from "@/components/GlobalSettings";
import { FormRow, FormSection } from "./FormRow";
import { NumberField } from "./NumberField";
import { toast } from "@/components/ui/use-toast";
import FloorplanPicker from "./MediaDropdown";
import { GradientEditor } from "./GradientEditor";
import EditableApMapping from "./ApMapping";
import { sanitizeFilename } from "@/lib/utils";

export default function SettingsEditor() {
  const { settings, updateSettings, readNewSettingsFromFile } = useSettings();

  const deleteFloorplan = async (name: string) => {
    const res = await fetch(`/api/media/${encodeURIComponent(name)}`, {
      method: "DELETE",
    });
    if (!res.ok && res.status !== 404) {
      toast({
        variant: "destructive",
        title: "Could not delete floor plan",
        description:
          (await res.json().catch(() => ({}))).error ?? res.statusText,
      });
      return;
    }
    await fetch(`/api/settings?name=${encodeURIComponent(name)}`, {
      method: "DELETE",
    });
    toast({ title: "Floor plan deleted", description: name });
    readNewSettingsFromFile(DEFAULT_FLOORPLAN);
  };

  return (
    <div className="mx-auto max-w-5xl">
      <FormSection
        title="Floor plan"
        description="The image you click on to place measurements. Each floor plan keeps its own survey."
      >
        <FormRow
          label="Current floor plan"
          help="Pick an image, or upload a PNG, JPEG or WebP. A photo of a sketch works fine: heat maps are approximate by nature."
          hint={
            settings.floorplanImageName && (
              <>
                Survey saved as{" "}
                <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">
                  data/surveys/{sanitizeFilename(settings.floorplanImageName)}
                  .json
                </code>
              </>
            )
          }
        >
          <FloorplanPicker
            value={settings.floorplanImageName}
            pointCount={settings.surveyPoints.length}
            onChange={readNewSettingsFromFile}
            onDelete={deleteFloorplan}
          />
        </FormRow>
      </FormSection>

      <FormSection
        title="Access point names"
        description="Optional. Name your access points by MAC address (BSSID) and the survey shows the name instead of the address."
      >
        <EditableApMapping
          apMapping={settings.apMapping}
          onSave={(apMapping) => updateSettings({ apMapping })}
        />
      </FormSection>

      <FormSection
        title="Heat map colours"
        description="Green is good. The scale runs from 0% (no signal, -100 dBm) to 100% (-40 dBm). Throughput maps reuse the same colours across their own range."
      >
        <FormRow label="Colour stops">
          <GradientEditor
            gradient={settings.gradient}
            onChange={(gradient) => updateSettings({ gradient })}
          />
        </FormRow>
        <div className="grid gap-5 sm:grid-cols-2">
          <FormRow
            id="maxOpacity"
            label="Opacity at strongest"
            help="How much the heat map covers the floor plan where the signal is strongest. 0 is invisible, 1 is solid."
          >
            <NumberField
              id="maxOpacity"
              min={0}
              max={1}
              step={0.1}
              value={settings.maxOpacity}
              onChange={(n) => updateSettings({ maxOpacity: n })}
            />
          </FormRow>
          <FormRow
            id="minOpacity"
            label="Opacity at weakest"
            help="Opacity where the signal is weakest."
          >
            <NumberField
              id="minOpacity"
              min={0}
              max={1}
              step={0.1}
              value={settings.minOpacity}
              onChange={(n) => updateSettings({ minOpacity: n })}
            />
          </FormRow>
        </div>
      </FormSection>
    </div>
  );
}
