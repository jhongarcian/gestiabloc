"use client"

import Link from "next/link"
import { Loader2 } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { AppPhoneInput } from "@/components/ui/phone-input"
import { Textarea } from "@/components/ui/textarea"
import {
  profileDraft,
  profileFields,
  PROFILE_LABELS,
  type AccountField,
  type AccountProfileDraft,
} from "@/lib/account-profile"
import type { AccountProfileController } from "./use-account-profile"
import { AccountTimezoneField } from "./account-timezone-field"

const PRIMARY =
  "h-8 shrink-0 cursor-pointer rounded-full bg-blue-950 px-3 py-1 text-xs font-semibold text-white shadow-sm ring-1 ring-black/5 hover:bg-blue-900 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500"
const SECONDARY =
  "h-8 shrink-0 cursor-pointer rounded-full border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed"
export const PROFILE_INPUT =
  "h-11 rounded-xl border-slate-200 bg-slate-50/60 focus-visible:border-blue-300 focus-visible:ring-blue-100"
const TEXTAREA =
  "min-h-28 rounded-xl border-slate-200 bg-slate-50/60 focus-visible:border-blue-300 focus-visible:ring-blue-100"

function ProfilePanel({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: React.ReactNode
}) {
  return (
    <Card className="min-w-0 gap-4 rounded-[22px] border-slate-200 py-5 shadow-none">
      <CardHeader className="gap-1 px-5">
        <CardTitle>
          <h2 className="text-base">{title}</h2>
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="min-w-0 px-5">{children}</CardContent>
    </Card>
  )
}

function ProfileInput({
  controller,
  field,
  maxLength,
  type = "text",
  hint,
}: {
  controller: AccountProfileController
  field: Exclude<keyof AccountProfileDraft, "taxEnabled">
  maxLength: number
  type?: string
  hint?: string
}) {
  const { draft, setField, fieldErrors, busy, ready } = controller
  const id = `company-${field}`
  const error = fieldErrors[field]
  const disabled =
    !ready ||
    Boolean(busy) ||
    ((field === "taxLabel" || field === "defaultTaxRatePercent") &&
      !draft.taxEnabled)
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined
  return (
    <Field
      data-invalid={Boolean(error)}
      data-disabled={disabled}
      className="min-w-0"
    >
      <FieldLabel htmlFor={id}>{PROFILE_LABELS[field]}</FieldLabel>
      {field === "description" ? (
        <Textarea
          id={id}
          className={TEXTAREA}
          rows={5}
          maxLength={maxLength}
          value={draft[field]}
          disabled={disabled}
          onChange={(event) => setField(field, event.target.value)}
          aria-invalid={Boolean(error)}
          aria-describedby={describedBy}
        />
      ) : field === "phone" ? (
        <AppPhoneInput
          id={id}
          defaultCountry="US"
          international
          countryCallingCodeEditable={false}
          className="[&_input]:h-11 [&_input]:rounded-xl"
          value={draft.phone || undefined}
          onChange={(value) => setField("phone", value ?? "")}
          disabled={disabled}
          maxLength={maxLength}
          aria-invalid={Boolean(error)}
          aria-describedby={describedBy}
        />
      ) : (
        <Input
          id={id}
          className={PROFILE_INPUT}
          type={type}
          inputMode={
            field === "website"
              ? "url"
              : field === "defaultTaxRatePercent"
                ? "decimal"
                : undefined
          }
          maxLength={maxLength}
          value={draft[field]}
          disabled={disabled}
          onChange={(event) => setField(field, event.target.value)}
          aria-invalid={Boolean(error)}
          aria-describedby={describedBy}
        />
      )}
      {hint ? (
        <FieldDescription id={`${id}-hint`}>{hint}</FieldDescription>
      ) : null}
      {error ? <FieldError id={`${id}-error`}>{error}</FieldError> : null}
    </Field>
  )
}

export function AccountProfileForm({
  controller,
  relatedHref,
}: {
  controller: AccountProfileController
  relatedHref: string
}) {
  const {
    scope,
    draft,
    ready,
    dirty,
    busy,
    error,
    fieldErrors,
    conflict,
    savedProfile,
    save,
    reload,
    resolveConflict,
    setField,
  } = controller
  const isCompany = scope === "company"
  const savedDraft = profileDraft(savedProfile)
  const latestDraft = profileDraft(conflict)
  const changedElsewhere = conflict
    ? profileFields(scope).filter((key) => latestDraft[key] !== savedDraft[key])
    : []
  const saveButton = dirty ? (
    <Button
      type="submit"
      className={PRIMARY}
      disabled={
        !ready ||
        Boolean(busy) ||
        Boolean(conflict) ||
        Object.keys(fieldErrors).length > 0
      }
    >
      {busy === "save" ? (
        <Loader2
          data-icon="inline-start"
          className="animate-spin"
          aria-hidden="true"
        />
      ) : null}
      {busy === "save" ? "Saving…" : "Save changes"}
    </Button>
  ) : null
  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault()
        void save()
      }}
      className="flex min-w-0 flex-col gap-4 pb-6"
    >
      <header className="rounded-[26px] border border-slate-200 bg-[linear-gradient(135deg,#f8fafc_0%,#eff6ff_48%,#fff7ed_100%)] p-4 sm:p-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex min-w-0 flex-col gap-2">
            <p className="text-xs font-semibold text-blue-700">
              {isCompany ? "AI workspace" : "Account settings"}
            </p>
            <div className="flex flex-col gap-1">
              <h1 className="text-2xl font-semibold text-slate-950">
                {isCompany ? "Company Info" : "Account"}
              </h1>
              <p className="text-sm text-slate-600">
                {isCompany
                  ? "Give every skill the same company context and contact information."
                  : "Manage your company profile, location, and billing defaults."}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="outline" className={SECONDARY}>
              <Link href={relatedHref}>
                {isCompany ? "Account settings" : "AI Company Info"}
              </Link>
            </Button>
            {saveButton}
          </div>
        </div>
      </header>
      {error ? (
        <Alert variant="destructive" className="rounded-2xl" role="alert">
          <AlertTitle>
            {ready
              ? "Changes were not saved"
              : "Company information unavailable"}
          </AlertTitle>
          <AlertDescription>
            {error}
            {!ready ? (
              <Button
                type="button"
                variant="outline"
                className={SECONDARY}
                disabled={Boolean(busy)}
                onClick={() => void reload()}
              >
                {busy === "load" ? "Loading…" : "Retry loading"}
              </Button>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}
      {conflict ? (
        <Alert className="rounded-2xl border-amber-200 bg-amber-50">
          <AlertTitle>Newer account information was saved</AlertTitle>
          <AlertDescription className="gap-3 text-slate-700">
            <p>
              Your edits are still in the form. Review the saved values before
              choosing how to continue.
            </p>
            {changedElsewhere.length ? (
              <dl className="grid min-w-0 gap-3 text-sm sm:grid-cols-2">
                {changedElsewhere.map((key: AccountField) => (
                  <div key={key} className="min-w-0">
                    <dt className="font-medium">
                      Saved {PROFILE_LABELS[key].toLowerCase()}
                    </dt>
                    <dd className="max-h-28 overflow-auto whitespace-pre-wrap break-words">
                      {typeof latestDraft[key] === "boolean"
                        ? latestDraft[key]
                          ? "Enabled"
                          : "Disabled"
                        : latestDraft[key] || "Not provided"}
                    </dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p>
                Other account settings changed. Your company edits can be
                reviewed and saved again.
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                className={SECONDARY}
                disabled={Boolean(busy)}
                onClick={() => resolveConflict(false)}
              >
                Use saved information
              </Button>
              <Button
                type="button"
                variant="outline"
                className={SECONDARY}
                disabled={Boolean(busy)}
                onClick={() => resolveConflict(true)}
              >
                Keep my edits
              </Button>
            </div>
            <p className="text-xs">
              Keeping your edits lets you review them before selecting Save
              changes.
            </p>
          </AlertDescription>
        </Alert>
      ) : null}
      <ProfilePanel
        title="About your company"
        description="Shared with Account Settings and the AI helper."
      >
        <FieldGroup className="gap-5">
          <ProfileInput controller={controller} field="name" maxLength={120} />
          <ProfileInput
            controller={controller}
            field="description"
            maxLength={4000}
            hint="Explain who you help and how your team works."
          />
          <ProfileInput
            controller={controller}
            field="website"
            maxLength={255}
            hint="Use a website such as example.com or https://example.com."
          />
        </FieldGroup>
      </ProfilePanel>
      <ProfilePanel
        title="Contact details"
        description="Keep the same contact information wherever your company appears."
      >
        <FieldGroup className="grid gap-5 sm:grid-cols-2">
          <ProfileInput
            controller={controller}
            field="email"
            maxLength={255}
            type="email"
          />
          <ProfileInput controller={controller} field="phone" maxLength={60} />
        </FieldGroup>
      </ProfilePanel>
      <ProfilePanel
        title="Company address"
        description="Use the address saved on your account."
      >
        <FieldGroup className="gap-5">
          <ProfileInput
            controller={controller}
            field="addressLine1"
            maxLength={255}
          />
          <ProfileInput
            controller={controller}
            field="addressLine2"
            maxLength={255}
          />
          <div className="grid gap-5 sm:grid-cols-2">
            <ProfileInput
              controller={controller}
              field="city"
              maxLength={120}
            />
            <ProfileInput
              controller={controller}
              field="state"
              maxLength={120}
            />
            <ProfileInput
              controller={controller}
              field="postalCode"
              maxLength={40}
            />
            <ProfileInput
              controller={controller}
              field="country"
              maxLength={120}
            />
          </div>
        </FieldGroup>
      </ProfilePanel>
      {!isCompany ? (
        <>
          <ProfilePanel
            title="Location settings"
            description="Choose the timezone used for your account’s schedules."
          >
            <AccountTimezoneField controller={controller} />
          </ProfilePanel>
          <ProfilePanel
            title="Billing & Taxes"
            description="Set the account tax default used by taxable services."
          >
            <FieldGroup className="gap-5">
              <Field orientation="horizontal">
                <Checkbox
                  id="company-taxEnabled"
                  checked={draft.taxEnabled}
                  disabled={!ready || Boolean(busy)}
                  onCheckedChange={(checked) =>
                    setField("taxEnabled", checked === true)
                  }
                />
                <FieldLabel htmlFor="company-taxEnabled">
                  Enable taxes for this account
                </FieldLabel>
              </Field>
              <div className="grid gap-5 sm:grid-cols-2">
                <ProfileInput
                  controller={controller}
                  field="defaultTaxRatePercent"
                  maxLength={8}
                  hint="Enter a percentage from 0 to 100."
                />
                <ProfileInput
                  controller={controller}
                  field="taxLabel"
                  maxLength={60}
                  hint="Optional label, such as Sales Tax."
                />
              </div>
            </FieldGroup>
          </ProfilePanel>
        </>
      ) : null}
      <div className="flex justify-end" aria-live="polite">
        {saveButton}
      </div>
    </form>
  )
}
