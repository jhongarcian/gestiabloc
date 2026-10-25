"use client"

import { useRef } from "react"
import { Check, Loader2, Upload } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import {
  AI_AVATAR_PRESETS,
  AI_LANGUAGES,
  AI_TONES,
  type AiAvatarPreset,
} from "../_lib/helper-settings"
import { AiHelperAvatar, AVATAR_ICONS, AVATAR_LABELS } from "./ai-helper-avatar"
import {
  AiPageHeader,
  AiPanel,
  AiSelect,
  INPUT_CLASS,
  PRIMARY_BUTTON,
  SECONDARY_BUTTON,
  TEXTAREA_CLASS,
} from "./ai-ui"
import { useAiWorkspace } from "./ai-workspace"

function SaveHelperButton() {
  const {
    helperReady,
    helperDirty,
    helperBusy,
    fieldErrors,
    helperConflict,
    saveHelper,
    isSavingHelper,
  } = useAiWorkspace()
  return (
    <Button
      type="button"
      className={PRIMARY_BUTTON}
      disabled={
        !helperReady ||
        !helperDirty ||
        helperBusy ||
        Boolean(helperConflict) ||
        Object.keys(fieldErrors).length > 0
      }
      onClick={() => void saveHelper()}
    >
      {isSavingHelper ? (
        <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
      ) : null}
      {isSavingHelper ? "Saving…" : "Save changes"}
    </Button>
  )
}

function AvatarPicker() {
  const {
    helper,
    savedHelper,
    helperReady,
    helperBusy,
    isSavingAvatar,
    avatarError,
    setAvatarPreset,
    uploadAvatar,
    removeAvatar,
  } = useAiWorkspace()
  const input = useRef<HTMLInputElement>(null)
  const avatar = savedHelper?.avatar
  return (
    <AiPanel
      title="Helper avatar"
      description="Choose a built-in avatar or upload your own. Changes save immediately."
    >
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap items-center gap-4">
          <AiHelperAvatar
            avatar={avatar}
            name={helper.name.trim() || "AI Helper"}
            className="size-16"
          />
          <div className="flex min-w-0 flex-col gap-2">
            <div className="flex flex-wrap gap-2">
              {avatar?.imageUrl ? (
                <Button
                  variant="outline"
                  className={SECONDARY_BUTTON}
                  disabled={!helperReady || helperBusy}
                  onClick={() => void removeAvatar()}
                >
                  Remove image
                </Button>
              ) : null}
              <Button
                variant="outline"
                className={SECONDARY_BUTTON}
                disabled={!helperReady || helperBusy}
                onClick={() => input.current?.click()}
              >
                {isSavingAvatar ? (
                  <Loader2
                    className="size-3.5 animate-spin"
                    aria-hidden="true"
                  />
                ) : (
                  <Upload className="size-3.5" aria-hidden="true" />
                )}
                {isSavingAvatar
                  ? "Saving avatar…"
                  : avatar?.imageUrl
                    ? "Replace image"
                    : "Upload image"}
              </Button>
            </div>
            <p id="avatar-file-hint" className="text-xs text-slate-500">
              PNG, JPEG, or WebP. Up to 5 MB.
            </p>
          </div>
        </div>
        <input
          ref={input}
          type="file"
          className="hidden"
          aria-label="Upload helper avatar"
          aria-describedby="avatar-file-hint"
          accept="image/png,image/jpeg,image/webp"
          disabled={!helperReady || helperBusy}
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ""
            if (file) void uploadAvatar(file)
          }}
        />
        <div className="flex flex-col gap-2">
          <p
            id="avatar-gallery-label"
            className="text-sm font-medium text-slate-700"
          >
            Built-in avatars
          </p>
          <ToggleGroup
            type="single"
            spacing={2}
            value={avatar?.imageUrl ? "" : (avatar?.presetId ?? "bot")}
            disabled={!helperReady || helperBusy}
            onValueChange={(value) => {
              if (value) void setAvatarPreset(value as AiAvatarPreset)
            }}
            aria-labelledby="avatar-gallery-label"
            className="grid w-full grid-cols-2 gap-2 sm:grid-cols-4"
          >
            {AI_AVATAR_PRESETS.map((preset) => {
              const Icon = AVATAR_ICONS[preset]
              const selected = !avatar?.imageUrl && avatar?.presetId === preset
              return (
                <ToggleGroupItem
                  key={preset}
                  value={preset}
                  aria-label={`${AVATAR_LABELS[preset]} avatar`}
                  className="relative h-auto flex-col gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-4 text-slate-600 hover:bg-slate-100 data-[state=on]:border-blue-300 data-[state=on]:bg-blue-50 data-[state=on]:text-blue-950 focus-visible:ring-blue-400"
                >
                  <Icon className="size-6" aria-hidden="true" />
                  <span className="text-xs">{AVATAR_LABELS[preset]}</span>
                  {selected ? (
                    <Check
                      className="absolute top-2 right-2 size-3"
                      aria-hidden="true"
                    />
                  ) : null}
                </ToggleGroupItem>
              )
            })}
          </ToggleGroup>
        </div>
        {avatarError ? (
          <p role="alert" className="text-sm text-red-700">
            {avatarError}
          </p>
        ) : null}
        <p className="sr-only" role="status">
          {isSavingAvatar ? "Saving helper avatar" : ""}
        </p>
      </div>
    </AiPanel>
  )
}

export function AiSettings() {
  const {
    draft,
    setHelper,
    companyName,
    savedHelper,
    helperReady,
    helperBusy,
    helperError,
    fieldErrors,
    helperConflict,
    resolveHelperConflict,
    reloadHelper,
  } = useAiWorkspace()
  const helper = draft.helper
  const disabled = !helperReady || helperBusy
  return (
    <>
      <AiPageHeader
        title="Settings"
        description="Give your helper a name and a consistent way of speaking."
        actions={<SaveHelperButton />}
      />
      {helperError ? (
        <Alert variant="destructive" className="rounded-2xl" role="alert">
          <AlertTitle>
            {helperReady ? "Settings were not saved" : "Settings unavailable"}
          </AlertTitle>
          <AlertDescription>
            {helperError}
            {!helperReady ? (
              <Button
                variant="outline"
                className={SECONDARY_BUTTON}
                disabled={helperBusy}
                onClick={() => void reloadHelper()}
              >
                Retry loading
              </Button>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}
      {helperConflict ? (
        <Alert className="rounded-2xl border-amber-200 bg-amber-50">
          <AlertTitle>Another administrator saved changes</AlertTitle>
          <AlertDescription className="gap-3 text-slate-700">
            <p>
              Your edits are still in the form. Review the saved settings before
              choosing which version to keep.
            </p>
            <dl className="grid min-w-0 gap-2 text-sm sm:grid-cols-2">
              <div>
                <dt className="font-medium">Saved name</dt>
                <dd className="break-words">{helperConflict.name}</dd>
              </div>
              <div>
                <dt className="font-medium">Saved language and tone</dt>
                <dd>
                  {helperConflict.language} · {helperConflict.tone}
                </dd>
              </div>
              <div className="min-w-0 sm:col-span-2">
                <dt className="font-medium">Saved instructions</dt>
                <dd className="max-h-32 overflow-auto whitespace-pre-wrap break-words">
                  {helperConflict.instructions || "No general instructions"}
                </dd>
              </div>
            </dl>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                className={SECONDARY_BUTTON}
                onClick={() => resolveHelperConflict(false)}
              >
                Use saved settings
              </Button>
              <Button
                variant="outline"
                className={SECONDARY_BUTTON}
                onClick={() => resolveHelperConflict(true)}
              >
                Keep my edits
              </Button>
            </div>
            <p className="text-xs">
              Keeping your edits lets you review and save them with Save
              changes.
            </p>
          </AlertDescription>
        </Alert>
      ) : null}
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          <AvatarPicker />
          <AiPanel
            title="Helper identity"
            description="These preferences apply to the helper across all skills."
          >
            <FieldGroup className="gap-5">
              <Field data-invalid={Boolean(fieldErrors.name)}>
                <FieldLabel htmlFor="helper-name">Helper name</FieldLabel>
                <Input
                  id="helper-name"
                  className={INPUT_CLASS}
                  maxLength={80}
                  value={helper.name}
                  disabled={disabled}
                  onChange={(event) =>
                    setHelper({ ...helper, name: event.target.value })
                  }
                  aria-invalid={Boolean(fieldErrors.name)}
                  aria-describedby={
                    fieldErrors.name ? "helper-name-error" : "helper-name-hint"
                  }
                />
                <FieldDescription id="helper-name-hint">
                  The sidebar updates as you type. Save changes to keep the
                  name.
                </FieldDescription>
                {fieldErrors.name ? (
                  <FieldError id="helper-name-error">
                    {fieldErrors.name}
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
                  options={AI_LANGUAGES}
                  disabled={disabled}
                  onChange={(language) => setHelper({ ...helper, language })}
                />
                {helper.language === "English and Spanish" ? (
                  <FieldDescription>
                    The helper will match the language of the question.
                  </FieldDescription>
                ) : null}
              </Field>
              <Field>
                <FieldLabel htmlFor="helper-tone">Tone</FieldLabel>
                <AiSelect
                  id="helper-tone"
                  label="Tone"
                  value={helper.tone}
                  options={AI_TONES}
                  disabled={disabled}
                  onChange={(tone) => setHelper({ ...helper, tone })}
                />
              </Field>
              <Field data-invalid={Boolean(fieldErrors.instructions)}>
                <FieldLabel htmlFor="helper-instructions">
                  General instructions
                </FieldLabel>
                <Textarea
                  id="helper-instructions"
                  className={TEXTAREA_CLASS}
                  rows={6}
                  maxLength={4000}
                  value={helper.instructions}
                  disabled={disabled}
                  onChange={(event) =>
                    setHelper({ ...helper, instructions: event.target.value })
                  }
                  aria-invalid={Boolean(fieldErrors.instructions)}
                  aria-describedby={
                    fieldErrors.instructions
                      ? "helper-instructions-error"
                      : "helper-instructions-hint"
                  }
                />
                <FieldDescription id="helper-instructions-hint">
                  Describe how the helper should guide a conversation and when
                  to involve your team.{" "}
                  {helper.instructions.length.toLocaleString()} / 4,000
                  characters.
                </FieldDescription>
                {fieldErrors.instructions ? (
                  <FieldError id="helper-instructions-error">
                    {fieldErrors.instructions}
                  </FieldError>
                ) : null}
              </Field>
            </FieldGroup>
          </AiPanel>
        </div>
        <AiPanel
          title="Identity preview"
          description="A sample greeting, without a live AI conversation."
        >
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <AiHelperAvatar
                avatar={savedHelper?.avatar}
                name={helper.name.trim() || "AI Helper"}
              />
              <div className="min-w-0">
                <p className="break-words text-sm font-semibold text-slate-950">
                  {helper.name.trim() || "AI Helper"}
                </p>
                <p className="break-words text-xs text-slate-500">
                  {companyName}
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
              Save your preferences now. Language, tone, and instructions will
              guide replies once AI conversations are connected.
            </p>
          </div>
        </AiPanel>
      </div>
      <div className="flex justify-end">
        <SaveHelperButton />
      </div>
    </>
  )
}
