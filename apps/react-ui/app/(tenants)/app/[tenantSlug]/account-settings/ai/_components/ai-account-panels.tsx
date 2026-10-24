"use client"

import { Bot } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { isSourceUrl } from "../_lib/demo-data"
import {
  AiPageHeader,
  AiPanel,
  AiSelect,
  DraftButton,
  INPUT_CLASS,
  TEXTAREA_CLASS,
} from "./ai-ui"
import { useAiWorkspace } from "./ai-workspace"

export function AiCompanyInfo() {
  const { draft, setCompany } = useAiWorkspace()
  const company = draft.company
  const nameError = company.name.trim() ? "" : "Enter a company name."
  const websiteError =
    !company.website || isSourceUrl(company.website)
      ? ""
      : "Enter a complete http:// or https:// URL."
  const emailError =
    !company.email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(company.email.trim())
      ? ""
      : "Enter a valid email address."
  const valid = !nameError && !websiteError && !emailError
  return (
    <>
      <AiPageHeader
        title="Company Info"
        description="Give every skill the same company context and contact information."
        actions={
          <DraftButton draftKey="company" value={company} valid={valid} />
        }
      />
      <AiPanel
        title="About your company"
        description="This fictional company profile is shared across all sample skills."
      >
        <FieldGroup className="gap-5">
          <Field data-invalid={Boolean(nameError)}>
            <FieldLabel htmlFor="company-name">Company name</FieldLabel>
            <Input
              id="company-name"
              className={INPUT_CLASS}
              value={company.name}
              onChange={(event) =>
                setCompany({ ...company, name: event.target.value })
              }
              aria-invalid={Boolean(nameError)}
              aria-describedby={nameError ? "company-name-error" : undefined}
            />
            {nameError ? (
              <FieldError id="company-name-error">{nameError}</FieldError>
            ) : null}
          </Field>
          <Field>
            <FieldLabel htmlFor="company-description">
              Company description
            </FieldLabel>
            <Textarea
              id="company-description"
              className={TEXTAREA_CLASS}
              value={company.description}
              onChange={(event) =>
                setCompany({ ...company, description: event.target.value })
              }
            />
            <FieldDescription>
              Explain who you help and how your team works.
            </FieldDescription>
          </Field>
          <Field data-invalid={Boolean(websiteError)}>
            <FieldLabel htmlFor="company-website">Website</FieldLabel>
            <Input
              id="company-website"
              type="url"
              className={INPUT_CLASS}
              value={company.website}
              onChange={(event) =>
                setCompany({ ...company, website: event.target.value })
              }
              aria-invalid={Boolean(websiteError)}
              aria-describedby={
                websiteError ? "company-website-error" : undefined
              }
            />
            {websiteError ? (
              <FieldError id="company-website-error">{websiteError}</FieldError>
            ) : null}
          </Field>
        </FieldGroup>
      </AiPanel>
      <AiPanel
        title="Contact details"
        description="Help your helper point people to the right place."
      >
        <FieldGroup className="grid gap-5 sm:grid-cols-2">
          <Field data-invalid={Boolean(emailError)}>
            <FieldLabel htmlFor="company-email">Contact email</FieldLabel>
            <Input
              id="company-email"
              type="email"
              className={INPUT_CLASS}
              value={company.email}
              onChange={(event) =>
                setCompany({ ...company, email: event.target.value })
              }
              aria-invalid={Boolean(emailError)}
              aria-describedby={emailError ? "company-email-error" : undefined}
            />
            {emailError ? (
              <FieldError id="company-email-error">{emailError}</FieldError>
            ) : null}
          </Field>
          <Field>
            <FieldLabel htmlFor="company-phone">Phone number</FieldLabel>
            <Input
              id="company-phone"
              type="tel"
              className={INPUT_CLASS}
              value={company.phone}
              onChange={(event) =>
                setCompany({ ...company, phone: event.target.value })
              }
            />
          </Field>
          <Field className="sm:col-span-2">
            <FieldLabel htmlFor="company-address">Address</FieldLabel>
            <Textarea
              id="company-address"
              className={TEXTAREA_CLASS}
              value={company.address}
              onChange={(event) =>
                setCompany({ ...company, address: event.target.value })
              }
            />
          </Field>
        </FieldGroup>
      </AiPanel>
      <div className="flex justify-end">
        <DraftButton draftKey="company" value={company} valid={valid} />
      </div>
    </>
  )
}

export function AiSettings() {
  const { draft, setHelper } = useAiWorkspace()
  const helper = draft.helper
  const valid = Boolean(helper.name.trim())
  return (
    <>
      <AiPageHeader
        title="Settings"
        description="Give your helper a name and a consistent way of speaking."
        actions={<DraftButton draftKey="helper" value={helper} valid={valid} />}
      />
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <AiPanel
          title="Helper identity"
          description="These preferences apply to the helper across all skills."
        >
          <FieldGroup className="gap-5">
            <Field data-invalid={!valid}>
              <FieldLabel htmlFor="helper-name">Helper name</FieldLabel>
              <Input
                id="helper-name"
                className={INPUT_CLASS}
                maxLength={80}
                value={helper.name}
                onChange={(event) =>
                  setHelper({ ...helper, name: event.target.value })
                }
                aria-invalid={!valid}
                aria-describedby={
                  !valid ? "helper-name-error" : "helper-name-hint"
                }
              />
              <FieldDescription id="helper-name-hint">
                The sidebar updates as you type.
              </FieldDescription>
              {!valid ? (
                <FieldError id="helper-name-error">
                  Enter a name for your helper.
                </FieldError>
              ) : null}
            </Field>
            <Field>
              <FieldLabel htmlFor="helper-language">
                Response language
              </FieldLabel>
              <AiSelect
                id="helper-language"
                label="Response language"
                value={helper.language}
                options={["English", "Spanish", "English and Spanish"]}
                onChange={(language) => setHelper({ ...helper, language })}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="helper-tone">Tone</FieldLabel>
              <AiSelect
                id="helper-tone"
                label="Tone"
                value={helper.tone}
                options={["Professional", "Warm", "Direct"]}
                onChange={(tone) => setHelper({ ...helper, tone })}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="helper-instructions">
                General instructions
              </FieldLabel>
              <Textarea
                id="helper-instructions"
                className={TEXTAREA_CLASS}
                rows={6}
                value={helper.instructions}
                onChange={(event) =>
                  setHelper({ ...helper, instructions: event.target.value })
                }
              />
              <FieldDescription>
                Describe how the helper should guide a conversation and when to
                involve your team.
              </FieldDescription>
            </Field>
          </FieldGroup>
        </AiPanel>
        <AiPanel
          title="Identity preview"
          description="A sample greeting, without a live AI conversation."
        >
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <div className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-blue-950 text-white">
                <Bot className="size-6" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <p className="break-words text-sm font-semibold text-slate-950">
                  {helper.name.trim() || "AI Helper"}
                </p>
                <p className="break-words text-xs text-slate-500">
                  {draft.company.name.trim() || "Your company"}
                </p>
              </div>
            </div>
            <div className="rounded-2xl bg-slate-50 p-4 text-sm leading-6 text-slate-600">
              Hi, I’m {helper.name.trim() || "AI Helper"}. I can help you
              understand our services and prepare for a conversation with our
              team.
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">{helper.language}</Badge>
              <Badge variant="outline">{helper.tone}</Badge>
            </div>
            <p className="text-xs leading-5 text-slate-500">
              Language, tone, and instructions are draft preferences. The
              greeting illustrates the helper’s identity.
            </p>
          </div>
        </AiPanel>
      </div>
      <div className="flex justify-end">
        <DraftButton draftKey="helper" value={helper} valid={valid} />
      </div>
    </>
  )
}
