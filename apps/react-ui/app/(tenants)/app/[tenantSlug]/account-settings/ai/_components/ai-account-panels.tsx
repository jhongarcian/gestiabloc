"use client"

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

export { AiSettings } from "./ai-helper-settings-panel"
