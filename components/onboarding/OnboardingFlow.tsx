"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  ageRangeOptions,
  defaultOnboardingValues,
  formatBudgetTypeLabel,
  getOperatingSystemLabel,
  getPreferenceLabel,
  getProblemLabel,
  laptopPortOptions,
  onboardingSteps,
  operatingSystemOptions,
  preferenceOptions,
  problemOptions,
  spendingStyleOptions,
  stepFieldGroups,
  type OnboardingFieldKey,
  type OnboardingFormValues,
  type PreferenceValue,
  validateOnboardingValues,
} from "@/lib/onboarding";
import { createDemoOnboardingProfile, saveOnboardingProfile } from "@/app/onboarding/actions";
import type { UserProblem } from "@/lib/recommendation/types";

export function OnboardingFlow() {
  const router = useRouter();
  const [currentStep, setCurrentStep] = useState(0);
  const [values, setValues] = useState<OnboardingFormValues>(defaultOnboardingValues);
  const [errors, setErrors] = useState<Partial<Record<OnboardingFieldKey, string>>>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const progress = ((currentStep + 1) / onboardingSteps.length) * 100;

  function setField<K extends OnboardingFieldKey>(field: K, value: OnboardingFormValues[K]) {
    setValues((currentValues) => ({
      ...currentValues,
      [field]: value,
    }));

    setErrors((currentErrors) => {
      const nextErrors = { ...currentErrors };
      delete nextErrors[field];
      return nextErrors;
    });

    setSaveError(null);
  }

  function toggleProblem(problem: UserProblem) {
    const nextProblems = values.problems.includes(problem)
      ? values.problems.filter((item) => item !== problem)
      : [...values.problems, problem];

    setField("problems", nextProblems);
  }

  function togglePreference(preference: PreferenceValue) {
    const nextPreferences = values.preferences.includes(preference)
      ? values.preferences.filter((item) => item !== preference)
      : [...values.preferences, preference];

    setField("preferences", nextPreferences);
  }

  function togglePort(port: string) {
    const nextPorts = values.laptopPorts.includes(port)
      ? values.laptopPorts.filter((item) => item !== port)
      : [...values.laptopPorts, port];

    setField("laptopPorts", nextPorts);
  }

  function validateStep(stepIndex: number) {
    const validationErrors = validateOnboardingValues(values);
    const relevantFields = stepFieldGroups[stepIndex] ?? [];
    const stepErrors = relevantFields.reduce<Partial<Record<OnboardingFieldKey, string>>>((accumulator, field) => {
      if (validationErrors[field]) {
        accumulator[field] = validationErrors[field];
      }
      return accumulator;
    }, {});

    if (Object.keys(stepErrors).length > 0) {
      setErrors((currentErrors) => ({
        ...currentErrors,
        ...stepErrors,
      }));
      return false;
    }

    return true;
  }

  function goToNextStep() {
    if (!validateStep(currentStep)) {
      return;
    }

    setCurrentStep((step) => Math.min(step + 1, onboardingSteps.length - 1));
  }

  function goToPreviousStep() {
    setCurrentStep((step) => Math.max(step - 1, 0));
  }

  function firstStepWithError(nextErrors: Partial<Record<OnboardingFieldKey, string>>) {
    return stepFieldGroups.findIndex((fields) => fields.some((field) => Boolean(nextErrors[field])));
  }

  function handleSave() {
    const nextErrors = validateOnboardingValues(values);

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      const stepWithError = firstStepWithError(nextErrors);
      if (stepWithError >= 0) {
        setCurrentStep(stepWithError);
      }
      return;
    }

    setSaveError(null);

    startTransition(async () => {
      const result = await saveOnboardingProfile(values);

      if (!result.success) {
        if (result.errors) {
          setErrors(result.errors);
          const stepWithError = firstStepWithError(result.errors);
          if (stepWithError >= 0) {
            setCurrentStep(stepWithError);
          }
        }

        setSaveError(result.error ?? "We couldn't save the profile.");
        return;
      }

      router.push("/inventory?toast=profile_saved");
      router.refresh();
    });
  }

  function handleDemoProfile() {
    setSaveError(null);

    startTransition(async () => {
      const result = await createDemoOnboardingProfile();

      if (!result.success) {
        setSaveError(result.error ?? "We couldn't create the demo profile.");
        return;
      }

      router.push("/inventory?toast=demo_profile_ready");
      router.refresh();
    });
  }

  const currentStepConfig = onboardingSteps[currentStep];

  return (
    <div className="grid gap-6 xl:grid-cols-[0.88fr_1.12fr]">
      <aside className="overflow-hidden rounded-[2rem] bg-[linear-gradient(160deg,rgba(23,33,31,1)_0%,rgba(37,56,51,1)_58%,rgba(66,104,90,0.94)_100%)] p-6 text-white shadow-panel lg:sticky lg:top-24 lg:h-fit lg:p-8">
        <div className="space-y-6">
          <div className="inline-flex w-fit rounded-full border border-white/12 bg-white/8 px-4 py-2 text-sm text-white/72">
            Demo-optimized onboarding
          </div>
          <div className="space-y-4">
            <h1 className="font-display text-3xl font-semibold md:text-4xl">
              Build a profile that makes the recommendation story feel personal in seconds.
            </h1>
            <p className="max-w-xl text-base leading-7 text-white/72">
              Keep the signal high: profession, pain points, preferences, and practical desk constraints. That gives
              the scoring engine enough context to explain every result without feeling generic.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
            <button
              type="button"
              onClick={handleDemoProfile}
              disabled={isPending}
              className="inline-flex w-full items-center justify-center rounded-full bg-gold px-5 py-3 text-sm font-semibold text-ink transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isPending ? "Working..." : "Load one-click demo"}
            </button>
            <div className="rounded-[1.5rem] border border-white/10 bg-white/8 p-4 text-sm leading-6 text-white/72">
              Best demo path: load the sample, jump to inventory, then open recommendations.
            </div>
          </div>
        </div>

        <div className="mt-8 rounded-3xl border border-white/10 bg-white/8 p-5 backdrop-blur">
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="text-sm text-white/60">Progress</p>
              <p className="mt-1 font-display text-2xl font-semibold">
                Step {currentStep + 1} of {onboardingSteps.length}
              </p>
            </div>
            <span className="rounded-full border border-white/10 px-3 py-1 text-sm text-white/75">
              {Math.round(progress)}%
            </span>
          </div>
          <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/10">
            <div className="h-full rounded-full bg-gold transition-all duration-300" style={{ width: `${progress}%` }} />
          </div>
          <div className="mt-6 space-y-3">
            {onboardingSteps.map((step, index) => {
              const isCurrent = index === currentStep;
              const isDone = index < currentStep;

              return (
                <button
                  key={step.title}
                  type="button"
                  onClick={() => setCurrentStep(index)}
                  className={`flex w-full items-start gap-3 rounded-2xl px-3 py-3 text-left transition ${
                    isCurrent ? "bg-white/12" : "hover:bg-white/6"
                  }`}
                >
                  <div
                    className={`mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full border text-sm font-semibold ${
                      isDone
                        ? "border-gold bg-gold text-ink"
                        : isCurrent
                          ? "border-white/40 bg-white/12 text-white"
                          : "border-white/15 text-white/65"
                    }`}
                  >
                    {isDone ? "✓" : index + 1}
                  </div>
                  <div>
                    <p className="font-semibold text-white">{step.title}</p>
                    <p className="mt-1 text-sm leading-6 text-white/62">{step.description}</p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-6 rounded-3xl border border-white/10 bg-white/6 p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/55">Why judges will like this</p>
          <div className="mt-4 space-y-3 text-sm leading-6 text-white/72">
            <p>Every answer maps to deterministic scoring inputs, not a hidden AI guess.</p>
            <p>The profile is concise enough to explain live in under 20 seconds.</p>
            <p>Room and budget constraints make the recommendations feel grounded and realistic.</p>
          </div>
        </div>
      </aside>

      <section className="rounded-[2rem] border border-white/80 bg-white/95 p-6 shadow-panel backdrop-blur md:p-8">
        <div className="flex flex-col gap-4 border-b border-ink/8 pb-6 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-moss">
              Step {currentStep + 1}
            </p>
            <h2 className="mt-3 font-display text-3xl font-semibold text-ink">{currentStepConfig.title}</h2>
            <p className="mt-3 max-w-2xl leading-7 text-ink/65">{currentStepConfig.description}</p>
          </div>
          <div className="rounded-[1.4rem] bg-[linear-gradient(135deg,rgba(23,33,31,0.96),rgba(66,104,90,0.92))] px-4 py-3 text-sm leading-6 text-white/85">
            Judge-friendly flow: answer, save, add current gear, reveal ranked upgrades.
          </div>
        </div>

        {saveError ? (
          <div className="mt-6 rounded-[1.4rem] border border-clay/20 bg-clay/10 px-4 py-3 text-sm text-ink">
            {saveError}
          </div>
        ) : null}

        <div className="mt-8">{renderStep()}</div>

        <div className="mt-10 flex flex-col gap-3 border-t border-ink/8 pt-6 sm:flex-row sm:items-center sm:justify-between">
          <button
            type="button"
            onClick={goToPreviousStep}
            disabled={currentStep === 0 || isPending}
            className="inline-flex items-center justify-center rounded-full border border-ink/10 px-5 py-3 text-sm font-semibold text-ink transition hover:border-moss/30 hover:bg-mist disabled:cursor-not-allowed disabled:opacity-50"
          >
            Back
          </button>

          {currentStep < onboardingSteps.length - 1 ? (
            <button
              type="button"
              onClick={goToNextStep}
              disabled={isPending}
              className="inline-flex items-center justify-center rounded-full bg-ink px-5 py-3 text-sm font-semibold text-white transition hover:bg-moss disabled:cursor-not-allowed disabled:opacity-60"
            >
              Continue
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSave}
              disabled={isPending}
              className="inline-flex items-center justify-center rounded-full bg-moss px-5 py-3 text-sm font-semibold text-white transition hover:bg-ink disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isPending ? "Saving..." : "Save profile"}
            </button>
          )}
        </div>
      </section>
    </div>
  );

  function renderStep() {
    switch (currentStep) {
      case 0:
        return (
          <div className="space-y-6">
            <div className="grid gap-5 md:grid-cols-2">
              <Field>
                <FieldLabel label="Profession" error={errors.profession} />
                <input
                  value={values.profession}
                  onChange={(event) => setField("profession", event.target.value)}
                  placeholder="Software engineer, CS student, analyst..."
                  className={inputClassName(Boolean(errors.profession))}
                />
              </Field>

              <Field>
                <FieldLabel label="Age range" error={errors.ageRange} />
                <select
                  value={values.ageRange}
                  onChange={(event) => setField("ageRange", event.target.value)}
                  className={inputClassName(Boolean(errors.ageRange))}
                >
                  <option value="">Select age range</option>
                  {ageRangeOptions.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            <div className="grid gap-5 md:grid-cols-[0.9fr_1.1fr]">
              <Field>
                <FieldLabel label="Budget type" />
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { value: "monthly", label: "Monthly" },
                    { value: "one_time", label: "One-time" },
                  ].map((option) => (
                    <SegmentedButton
                    key={option.value}
                    label={option.label}
                    selected={values.budgetType === option.value}
                    onClick={() => setField("budgetType", option.value as OnboardingFormValues["budgetType"])}
                  />
                  ))}
                </div>
              </Field>

              <Field>
                <FieldLabel label={formatBudgetTypeLabel(values.budgetType)} error={errors.budgetAmount} />
                <div className="relative">
                  <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-sm text-ink/45">
                    $
                  </span>
                  <input
                    value={values.budgetAmount}
                    onChange={(event) => setField("budgetAmount", event.target.value)}
                    inputMode="decimal"
                    placeholder="300"
                    className={`${inputClassName(Boolean(errors.budgetAmount))} pl-8`}
                  />
                </div>
              </Field>
            </div>

            <Field>
              <FieldLabel label="Spending style" />
              <div className="grid gap-3 md:grid-cols-3">
                {spendingStyleOptions.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setField("spendingStyle", option.value)}
                    className={`rounded-[1.4rem] border px-4 py-4 text-left transition ${
                      values.spendingStyle === option.value
                        ? "border-moss bg-[linear-gradient(180deg,rgba(66,104,90,0.12),rgba(66,104,90,0.05))] ring-4 ring-moss/10"
                        : "border-ink/10 bg-mist/60 hover:border-moss/25 hover:bg-white"
                    }`}
                  >
                    <p className="font-display font-semibold text-ink">{option.label}</p>
                    <p className="mt-2 text-sm leading-6 text-ink/65">{option.description}</p>
                  </button>
                ))}
              </div>
            </Field>

            <label className="flex items-center justify-between gap-4 rounded-[1.4rem] border border-ink/10 bg-mist/80 px-4 py-4">
              <div>
                <p className="font-display font-semibold text-ink">Used items okay</p>
                <p className="mt-1 text-sm leading-6 text-ink/65">
                  Helps the engine consider strong value upgrades and refurbished options.
                </p>
              </div>
              <input
                type="checkbox"
                checked={values.usedItemsOkay}
                onChange={(event) => setField("usedItemsOkay", event.target.checked)}
                className="size-5 rounded border-ink/20 accent-moss"
              />
            </label>
          </div>
        );
      case 1:
        return (
          <div className="space-y-5">
            <section className="rounded-[1.5rem] border border-moss/12 bg-moss/5 p-4 text-sm leading-6 text-ink/72">
              Select every issue that feels real today. These become the most visible “why” statements in the final
              dashboard.
            </section>
            <div className="grid gap-3 md:grid-cols-2">
              {problemOptions.map((problem) => {
                const selected = values.problems.includes(problem.value);

                return (
                  <SelectableCard
                    key={problem.value}
                    label={problem.label}
                    description={problem.description}
                    selected={selected}
                    onClick={() => toggleProblem(problem.value)}
                  />
                );
              })}
            </div>
          </div>
        );
      case 2:
        return (
          <div className="space-y-5">
            <section className="rounded-[1.5rem] border border-gold/20 bg-gold/10 p-4 text-sm leading-6 text-ink/72">
              Preferences tune tradeoffs like portability, noise, and aesthetic fit so the shortlist feels specific,
              not cookie-cutter.
            </section>
            <div className="grid gap-3 md:grid-cols-2">
              {preferenceOptions.map((preference) => {
                const selected = values.preferences.includes(preference.value);

                return (
                  <SelectableCard
                    key={preference.value}
                    label={preference.label}
                    description={preference.description}
                    selected={selected}
                    onClick={() => togglePreference(preference.value)}
                  />
                );
              })}
            </div>
          </div>
        );
      case 3:
        return (
          <div className="space-y-6">
            <div className="grid gap-5 md:grid-cols-2">
              <Field>
                <FieldLabel label="Desk width" error={errors.deskWidth} />
                <div className="relative">
                  <input
                    value={values.deskWidth}
                    onChange={(event) => setField("deskWidth", event.target.value)}
                    inputMode="numeric"
                    placeholder="42"
                    className={`${inputClassName(Boolean(errors.deskWidth))} pr-16`}
                  />
                  <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-sm text-ink/45">
                    inches
                  </span>
                </div>
              </Field>

              <Field>
                <FieldLabel label="Small room" />
                <div className="grid grid-cols-2 gap-3">
                  <SegmentedButton label="Yes" selected={values.smallRoom} onClick={() => setField("smallRoom", true)} />
                  <SegmentedButton label="No" selected={!values.smallRoom} onClick={() => setField("smallRoom", false)} />
                </div>
              </Field>
            </div>

            <Field>
              <FieldLabel label="Laptop ports" />
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {laptopPortOptions.map((port) => (
                  <button
                    key={port}
                    type="button"
                    onClick={() => togglePort(port)}
                    className={`rounded-[1.25rem] border px-4 py-3 text-left text-sm font-semibold transition ${
                      values.laptopPorts.includes(port)
                        ? "border-moss bg-moss/10 text-ink ring-4 ring-moss/10"
                        : "border-ink/10 bg-mist/70 text-ink/75 hover:border-moss/25 hover:bg-white"
                    }`}
                  >
                    {port}
                  </button>
                ))}
              </div>
            </Field>

            <Field>
              <FieldLabel label="Operating system" error={errors.operatingSystem} />
              <select
                value={values.operatingSystem}
                onChange={(event) =>
                  setField("operatingSystem", event.target.value as OnboardingFormValues["operatingSystem"])
                }
                className={inputClassName(Boolean(errors.operatingSystem))}
              >
                <option value="">Select operating system</option>
                {operatingSystemOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        );
      case 4:
        return (
          <div className="space-y-6">
            <div className="grid gap-4 lg:grid-cols-2">
              <ReviewCard
                title="Basic profile"
                rows={[
                  { label: "Profession", value: values.profession || "Not set" },
                  { label: "Age range", value: values.ageRange || "Not set" },
                  { label: formatBudgetTypeLabel(values.budgetType), value: values.budgetAmount ? `$${values.budgetAmount}` : "Not set" },
                  {
                    label: "Spending style",
                    value:
                      spendingStyleOptions.find((option) => option.value === values.spendingStyle)?.label ?? values.spendingStyle,
                  },
                  { label: "Used items okay", value: values.usedItemsOkay ? "Yes" : "No" },
                ]}
              />

              <ReviewCard
                title="Room constraints"
                rows={[
                  { label: "Desk width", value: values.deskWidth ? `${values.deskWidth} inches` : "Not set" },
                  { label: "Small room", value: values.smallRoom ? "Yes" : "No" },
                  {
                    label: "Laptop ports",
                    value: values.laptopPorts.length > 0 ? values.laptopPorts.join(", ") : "No ports selected",
                  },
                  {
                    label: "Operating system",
                    value: values.operatingSystem ? getOperatingSystemLabel(values.operatingSystem) : "Not set",
                  },
                ]}
              />
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <TagSummaryCard
                title="Problems"
                emptyState="No problems selected yet."
                items={values.problems.map((problem) => getProblemLabel(problem))}
              />

              <TagSummaryCard
                title="Preferences"
                emptyState="No preferences selected yet."
                items={values.preferences.map((preference) => getPreferenceLabel(preference))}
              />
            </div>

            <div className="rounded-2xl border border-moss/15 bg-moss/8 px-5 py-4 text-sm leading-7 text-ink/72">
              Saving creates a profile in MongoDB and then sends the user straight to inventory so we
              can capture current gear next.
            </div>
          </div>
        );
      default:
        return null;
    }
  }
}

function Field({ children }: { children: React.ReactNode }) {
  return <div className="space-y-2">{children}</div>;
}

function FieldLabel({ label, error }: { label: string; error?: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm font-semibold text-ink/75">{label}</span>
      {error ? <span className="text-xs font-medium text-clay">{error}</span> : null}
    </div>
  );
}

function SegmentedButton({
  label,
  selected,
  onClick,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-[1.25rem] px-4 py-3 text-sm font-semibold transition ${
        selected
          ? "bg-[linear-gradient(135deg,#17211f_0%,#42685a_100%)] text-white shadow-soft"
          : "border border-ink/10 bg-white text-ink/80 hover:border-moss/25 hover:bg-mist"
      }`}
    >
      {label}
    </button>
  );
}

function SelectableCard({
  label,
  description,
  selected,
  onClick,
}: {
  label: string;
  description: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-[1.45rem] border px-4 py-4 text-left transition ${
        selected
          ? "border-moss bg-[linear-gradient(180deg,rgba(66,104,90,0.12),rgba(66,104,90,0.04))] ring-4 ring-moss/10"
          : "border-ink/10 bg-white hover:border-moss/25 hover:bg-mist"
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-display font-semibold text-ink">{label}</p>
          <p className="mt-2 text-sm leading-6 text-ink/65">{description}</p>
        </div>
        <span
          className={`mt-1 flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-bold ${
            selected ? "border-moss bg-moss text-white" : "border-ink/15 text-ink/35"
          }`}
        >
          {selected ? "✓" : "+"}
        </span>
      </div>
    </button>
  );
}

function ReviewCard({
  title,
  rows,
}: {
  title: string;
  rows: Array<{
    label: string;
    value: string;
  }>;
}) {
  return (
    <section className="rounded-3xl border border-ink/8 bg-white p-5">
      <h3 className="font-display text-lg font-semibold text-ink">{title}</h3>
      <div className="mt-4 space-y-3">
        {rows.map((row) => (
          <div key={row.label} className="flex items-start justify-between gap-4 border-b border-ink/6 pb-3 last:border-b-0 last:pb-0">
            <span className="text-sm text-ink/60">{row.label}</span>
            <span className="text-right text-sm font-medium text-ink">{row.value}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function TagSummaryCard({
  title,
  items,
  emptyState,
}: {
  title: string;
  items: string[];
  emptyState: string;
}) {
  return (
    <section className="rounded-3xl border border-ink/8 bg-white p-5">
      <h3 className="font-display text-lg font-semibold text-ink">{title}</h3>
      <div className="mt-4 flex flex-wrap gap-2">
        {items.length > 0 ? (
          items.map((item) => (
            <span key={item} className="rounded-full bg-mist px-3 py-2 text-sm font-medium text-ink/80">
              {item}
            </span>
          ))
        ) : (
          <p className="text-sm leading-6 text-ink/60">{emptyState}</p>
        )}
      </div>
    </section>
  );
}

function inputClassName(hasError: boolean) {
  return `w-full rounded-[1.25rem] border bg-white px-4 py-3 text-base text-ink outline-none transition placeholder:text-ink/40 focus:ring-4 ${
    hasError ? "border-clay/40 ring-clay/10" : "border-ink/10 ring-moss/10 focus:border-moss/30"
  }`;
}
