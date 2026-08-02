import { useApp } from "../context/useApp";
import PageHeader from "../components/PageHeader";

const inputClass =
  "w-full rounded-lg border border-slate-700 bg-slate-800 px-4 py-2.5 text-sm text-white focus:border-cyan-500 focus:outline-none";

const toggleClass = (on) =>
  `relative h-6 w-11 shrink-0 rounded-full transition-colors ${on ? "bg-cyan-500" : "bg-slate-700"}`;

const knobClass = (on) =>
  `absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white transition-transform ${on ? "translate-x-5" : ""}`;

function Toggle({ label, description, checked, onChange }) {
  return (
    <div className="flex items-center justify-between gap-6">
      <div>
        <p className="text-sm font-medium text-white">{label}</p>
        <p className="mt-0.5 text-xs text-slate-400">{description}</p>
      </div>
      <button onClick={onChange} className={toggleClass(checked)} aria-label={label}>
        <span className={knobClass(checked)}></span>
      </button>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-xl">
      <h2 className="mb-5 text-lg font-bold text-white">{title}</h2>
      <div className="space-y-5">{children}</div>
    </div>
  );
}

const ACCENTS = [
  { key: "cyan", label: "Cyan", classes: "bg-cyan-500" },
  { key: "emerald", label: "Emerald", classes: "bg-emerald-500" },
  { key: "violet", label: "Violet", classes: "bg-violet-500" },
];

const REGIONS = ["ap-south-1", "us-east-1", "eu-west-1", "ap-southeast-1"];

export default function Settings() {
  const { settings, updateSettings, resetSettings, addNotification } = useApp();

  const save = () => {
    addNotification("success", "Settings saved successfully");
  };

  return (
    <div>
      <PageHeader
        title="Settings"
        subtitle="Configure the scale-to-zero engine, notifications and cloud preferences."
        actions={
          <>
            <button
              onClick={save}
              className="rounded-lg bg-cyan-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-cyan-500"
            >
              Save
            </button>
            <button
              onClick={resetSettings}
              className="rounded-lg bg-slate-700 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-600"
            >
              Reset
            </button>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Section title="General">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-300">
              Company Name
            </label>
            <input
              value={settings.companyName}
              onChange={(e) => updateSettings({ companyName: e.target.value })}
              className={inputClass}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-300">
              Cloud Region
            </label>
            <select
              value={settings.region}
              onChange={(e) => updateSettings({ region: e.target.value })}
              className={inputClass}
            >
              {REGIONS.map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
          </div>
          <Toggle
            label="Notifications"
            description="Show system notifications for cluster events"
            checked={settings.notifications}
            onChange={() => updateSettings({ notifications: !settings.notifications })}
          />
        </Section>

        <Section title="Auto Scale">
          <Toggle
            label="Auto Scale"
            description="Automatically scale idle workspaces to zero"
            checked={settings.autoScale}
            onChange={() => updateSettings({ autoScale: !settings.autoScale })}
          />
          <Toggle
            label="Engine Paused"
            description="Pause all autonomous scaling decisions"
            checked={settings.enginePaused}
            onChange={() => updateSettings({ enginePaused: !settings.enginePaused })}
          />
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-300">
              Idle Timeout: {settings.idleTimeout} minutes
            </label>
            <input
              type="range"
              min={5}
              max={60}
              step={5}
              value={settings.idleTimeout}
              onChange={(e) => updateSettings({ idleTimeout: Number(e.target.value) })}
              className="w-full accent-cyan-500"
            />
            <p className="mt-1 text-xs text-slate-400">
              Workspaces idle beyond this limit are scaled to zero automatically.
            </p>
          </div>
        </Section>

        <Section title="Cloud Settings">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-300">
              Scale-to-Zero Savings Estimate
            </label>
            <p className="rounded-lg bg-slate-800/60 px-4 py-3 text-sm text-slate-300">
              ₹45 per workspace per scale event · ~₹1,350 / workspace / month
            </p>
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-300">
              Node Count
            </label>
            <p className="rounded-lg bg-slate-800/60 px-4 py-3 text-sm text-slate-300">
              3 worker nodes · 96 pod capacity · k8s 1.29
            </p>
          </div>
        </Section>

        <Section title="Appearance">
          <div>
            <label className="mb-2 block text-sm font-medium text-slate-300">
              Accent Color
            </label>
            <div className="flex gap-3">
              {ACCENTS.map((accent) => (
                <button
                  key={accent.key}
                  onClick={() => updateSettings({ accent: accent.key })}
                  className={`flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-medium transition ${
                    settings.accent === accent.key
                      ? "border-cyan-400 bg-slate-800 text-white"
                      : "border-slate-700 text-slate-400 hover:border-slate-500"
                  }`}
                >
                  <span className={`h-4 w-4 rounded-full ${accent.classes}`}></span>
                  {accent.label}
                </button>
              ))}
            </div>
          </div>
          <Toggle
            label="Compact Mode"
            description="Reduce spacing across dashboard cards"
            checked={false}
            onChange={() => addNotification("info", "Compact mode coming in a future release")}
          />
        </Section>
      </div>
    </div>
  );
}
