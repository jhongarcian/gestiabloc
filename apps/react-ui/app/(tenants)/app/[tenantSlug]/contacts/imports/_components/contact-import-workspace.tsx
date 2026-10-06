"use client"

import { isAxiosError } from "axios"
import { parsePhoneNumberFromString } from "libphonenumber-js"
import { ArrowLeft, CheckCircle2, Download, FileSpreadsheet, Loader2, UploadCloud, XCircle } from "lucide-react"
import Link from "next/link"
import { getCountries, getCountryCallingCode, type Country } from "react-phone-number-input"
import countryLabels from "react-phone-number-input/locale/en.json"
import { useCallback, useEffect, useMemo, useState } from "react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { api } from "@/lib/api"
import { formatPhoneNumber } from "@/lib/format-phone-number"
import { uploadPrivateFileToSignedUrl } from "@/lib/supabase-storage"

type Target = { kind: "CONTACT_FIELD"; key: string } | { kind: "CUSTOM_FIELD"; fieldId: string } | { kind: "IGNORE" }
type Mapping = { sourceIndex: number; sourceHeader: string; target: Target }
type ImportJob = {
  id: string; fileName: string; status: string; phase: string | null; totalRows: number; processedRows: number
  createdRows: number; duplicateRows: number; invalidRows: number; lastError: string | null; hasReport: boolean
  createdAt: string; completedAt: string | null
}
type Preview = {
  headers: string[]
  sampleRows: string[][]
  contactFields: Array<{ key: string; label: string }>
  catalog: {
    customFields: Array<{ id: string; key: string; label: string; fieldType: string; isEncrypted: boolean; isSensitive: boolean; isRequired: boolean }>
    statuses: Array<{ id: string; name: string }>
  }
  mappings: Mapping[]
  defaultStatusConfigId: string | null
}

const ACTIVE_STATUSES = new Set(["QUEUED", "PROCESSING", "CANCEL_REQUESTED"])
const MAX_FILE_BYTES = 500 * 1024 * 1024
const PHONE_KEYS = new Set(["phone", "secondaryPhone", "emergencyContactPhone"])
const DATE_KEYS = new Set(["dateOfBirth", "deceasedAt", "leadDate"])
const COUNTRY_OPTIONS = getCountries().map((code) => ({
  code,
  name: (countryLabels as Record<string, string>)[code] ?? code,
  callingCode: getCountryCallingCode(code),
})).sort((left, right) => left.name.localeCompare(right.name))

function countryFlag(code: string) {
  return String.fromCodePoint(...Array.from(code, (letter) => letter.charCodeAt(0) + 127397))
}

function formatSampleDate(value: string, format: "YYYY-MM-DD" | "MM/DD/YYYY" | "DD/MM/YYYY") {
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  const slash = !iso && format !== "YYYY-MM-DD" ? /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value) : null
  const match = iso ?? slash
  if (!match) return value
  const year = Number(iso ? match[1] : match[3])
  const month = Number(iso ? match[2] : format === "DD/MM/YYYY" ? match[2] : match[1])
  const day = Number(iso ? match[3] : format === "DD/MM/YYYY" ? match[1] : match[2])
  const date = new Date(Date.UTC(year, month - 1, day, 12))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return value
  return `${String(month).padStart(2, "0")}/${String(day).padStart(2, "0")}/${year}`
}

function formatSamplePhone(value: string, country: string) {
  const phone = parsePhoneNumberFromString(value, country as Country)
  return phone?.isPossible() ? formatPhoneNumber(phone.number) : value
}

function errorText(error: unknown) {
  if (isAxiosError(error)) {
    const data = error.response?.data as { message?: string; error?: string } | undefined
    if (data?.message) return data.message
    if (data?.error === "IMPORT_ALREADY_ACTIVE") return "Another contact import is already running for this account."
    if (data?.error) return data.error.replaceAll("_", " ").toLowerCase()
  }
  return error instanceof Error ? error.message : "The request could not be completed."
}

function labelForStatus(status: string) {
  return status.replaceAll("_", " ").toLowerCase().replace(/^./, (letter) => letter.toUpperCase())
}

export function ContactImportWorkspace({ tenantId, tenantSlug }: { tenantId: string; tenantSlug: string }) {
  const [file, setFile] = useState<File | null>(null)
  const [draftId, setDraftId] = useState<string | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [mappings, setMappings] = useState<Mapping[]>([])
  const [dateFormat, setDateFormat] = useState<"YYYY-MM-DD" | "MM/DD/YYYY" | "DD/MM/YYYY">("MM/DD/YYYY")
  const [phoneCountry, setPhoneCountry] = useState("US")
  const [multiSelectSeparator, setMultiSelectSeparator] = useState(";")
  const [defaultStatusConfigId, setDefaultStatusConfigId] = useState("")
  const [busy, setBusy] = useState(false)
  const [uploadPercent, setUploadPercent] = useState<number | null>(0)
  const [step, setStep] = useState<"upload" | "mapping" | "progress">("upload")
  const [jobs, setJobs] = useState<ImportJob[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const loadJobs = useCallback(async () => {
    const { data } = await api.get<{ items: ImportJob[] }>(`/api/contact-imports/${tenantId}`)
    setJobs(data.items ?? [])
  }, [tenantId])

  useEffect(() => { void loadJobs().catch(() => undefined) }, [loadJobs])
  useEffect(() => {
    if (!jobs.some((job) => ACTIVE_STATUSES.has(job.status))) return
    const timer = window.setInterval(() => void loadJobs().catch(() => undefined), 4000)
    return () => window.clearInterval(timer)
  }, [jobs, loadJobs])

  const selected = jobs.find((job) => job.id === selectedId) ?? null
  const hasActiveImport = jobs.some((job) => ACTIVE_STATUSES.has(job.status))
  const mappingError = useMemo(() => {
    if (!preview) return "Preview a CSV first."
    const targets = mappings.flatMap((item) => item.target.kind === "CONTACT_FIELD" ? [`standard:${item.target.key}`] : item.target.kind === "CUSTOM_FIELD" ? [`custom:${item.target.fieldId}`] : [])
    if (new Set(targets).size !== targets.length) return "Each destination can be mapped only once."
    for (const name of ["firstName", "lastName"]) {
      if (!mappings.some((item) => item.target.kind === "CONTACT_FIELD" && item.target.key === name)) return "Map first name and last name before importing."
    }
    if (!defaultStatusConfigId) return "Choose a default contact status."
    if (!COUNTRY_OPTIONS.some((option) => option.code === phoneCountry)) return "Choose a phone country."
    if (!multiSelectSeparator) return "Choose a multi-select separator."
    return null
  }, [preview, mappings, defaultStatusConfigId, phoneCountry, multiSelectSeparator])

  async function uploadAndPreview() {
    if (!file || busy) return
    if (file.size > MAX_FILE_BYTES || !file.name.toLowerCase().endsWith(".csv")) {
      toast.error("Choose a CSV file of 500 MB or less.")
      return
    }
    setBusy(true)
    setUploadPercent(0)
    try {
      const created = await api.post<{ import: ImportJob; upload: { bucket: string; fileId: string; path: string; token: string } }>(
        `/api/contact-imports/${tenantId}`, { fileName: file.name, fileSize: file.size },
      )
      setDraftId(created.data.import.id)
      await uploadPrivateFileToSignedUrl(created.data.upload, file, "text/csv", (fraction) => setUploadPercent(fraction === null ? null : Math.round(fraction * 100)))
      const response = await api.post<Preview>(`/api/contact-imports/${tenantId}/${created.data.import.id}/preview`)
      setPreview(response.data)
      setMappings(response.data.mappings)
      setDefaultStatusConfigId(response.data.defaultStatusConfigId ?? "")
      setStep("mapping")
      await loadJobs()
    } catch (error) { toast.error(errorText(error)) }
    finally { setBusy(false) }
  }

  async function queueImport() {
    if (!draftId || mappingError || busy) return
    setBusy(true)
    try {
      const { data } = await api.post<{ import: ImportJob }>(`/api/contact-imports/${tenantId}/${draftId}/queue`, {
        mappings, settings: { dateFormat, phoneCountry, multiSelectSeparator, defaultStatusConfigId },
      })
      setSelectedId(data.import.id)
      setStep("progress")
      await loadJobs()
      toast.success("Contact import queued.")
    } catch (error) { toast.error(errorText(error)) }
    finally { setBusy(false) }
  }

  async function cancelImport(job: ImportJob) {
    try {
      await api.post(`/api/contact-imports/${tenantId}/${job.id}/cancel`)
      await loadJobs()
      toast.success("Import cancellation requested.")
    } catch (error) { toast.error(errorText(error)) }
  }

  async function downloadReport(job: ImportJob) {
    try {
      const { data } = await api.post<{ url: string }>(`/api/contact-imports/${tenantId}/${job.id}/report-url`)
      window.open(data.url, "_blank", "noopener,noreferrer")
    } catch (error) { toast.error(errorText(error)) }
  }

  function resetWizard() {
    setFile(null); setDraftId(null); setPreview(null); setMappings([]); setUploadPercent(0); setStep("upload")
  }

  function changeMapping(index: number, value: string) {
    const target: Target = value === "ignore" ? { kind: "IGNORE" }
      : value.startsWith("standard:") ? { kind: "CONTACT_FIELD", key: value.slice(9) }
        : { kind: "CUSTOM_FIELD", fieldId: value.slice(7) }
    setMappings((current) => current.map((item) => item.sourceIndex === index ? { ...item, target } : item))
  }

  return (
    <section className="flex h-full min-h-0 flex-col gap-5 overflow-y-auto p-1 pb-8">
      <header className="rounded-[26px] border border-slate-200 bg-[linear-gradient(120deg,#eff6ff,#f8fafc_55%,#fff7ed)] px-5 py-6 sm:px-8">
        <Link href={`/app/${tenantSlug}/contacts`} className="mb-5 inline-flex items-center gap-2 text-xs font-semibold text-blue-900 hover:underline">
          <ArrowLeft aria-hidden="true" className="size-4" /> Back to contacts
        </Link>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-blue-700">Contact directory</p>
            <h1 className="mt-2 text-2xl font-semibold text-slate-950 sm:text-3xl">Import contacts</h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-600">Match CSV columns to contact fields, review the sample, then let the import run in the background.</p>
          </div>
          {step !== "upload" ? <Button variant="outline" onClick={resetWizard}>Start another</Button> : null}
        </div>
      </header>

      {step === "upload" ? (
        <Card className="rounded-[24px] border-slate-200">
          <CardHeader><CardTitle className="flex items-center gap-2"><UploadCloud className="size-5 text-blue-800" /> Upload a CSV</CardTitle>
            <CardDescription>Up to 500,000 contact rows and 500 MB. Your file stays in private storage.</CardDescription></CardHeader>
          <CardContent>
            <FieldGroup className="max-w-xl">
              <Field>
                <FieldLabel htmlFor="import-csv">CSV file</FieldLabel>
                <Input id="import-csv" type="file" accept=".csv,text/csv" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
                <FieldDescription>Use one header row. First name and last name columns are required.</FieldDescription>
              </Field>
              <Button disabled={!file || busy || hasActiveImport} onClick={() => void uploadAndPreview()}>
                {busy ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <FileSpreadsheet data-icon="inline-start" />}
                {busy ? `Uploading and previewing…${uploadPercent === null ? "" : ` ${uploadPercent}%`}` : "Review columns"}
              </Button>
              {busy && uploadPercent !== null ? <Progress value={uploadPercent} aria-label="CSV upload progress" /> : null}
              {hasActiveImport ? <p className="text-sm text-amber-700">Finish or cancel the active import before starting another.</p> : null}
            </FieldGroup>
          </CardContent>
        </Card>
      ) : null}

      {step === "mapping" && preview ? (
        <Card className="rounded-[24px] border-slate-200">
          <CardHeader><CardTitle>Match your columns</CardTitle><CardDescription>Each CSV column can fill one contact or custom field. Columns set to Ignore are left out.</CardDescription></CardHeader>
          <CardContent className="flex flex-col gap-6">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {mappings.map((item) => {
                const value = item.target.kind === "IGNORE" ? "ignore" : item.target.kind === "CONTACT_FIELD" ? `standard:${item.target.key}` : `custom:${item.target.fieldId}`
                return <Field key={item.sourceIndex} className="min-w-0 rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <FieldLabel htmlFor={`mapping-${item.sourceIndex}`} className="truncate">{item.sourceHeader}</FieldLabel>
                  <Select value={value} onValueChange={(next) => changeMapping(item.sourceIndex, next)}>
                    <SelectTrigger id={`mapping-${item.sourceIndex}`} className="w-full bg-white"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectGroup>
                      <SelectItem value="ignore">Ignore column</SelectItem>
                      {preview.contactFields.map((field) => <SelectItem key={field.key} value={`standard:${field.key}`}>{field.label}</SelectItem>)}
                      {preview.catalog.customFields.map((field) => <SelectItem key={field.id} value={`custom:${field.id}`}>{field.label} · {field.fieldType.toLowerCase()}{field.isRequired ? " · required" : ""}</SelectItem>)}
                    </SelectGroup></SelectContent>
                  </Select>
                </Field>
              })}
            </div>
            <div className="grid gap-4 rounded-xl border border-slate-200 p-4 sm:grid-cols-2 xl:grid-cols-4">
              <Field><FieldLabel htmlFor="import-date-format">CSV date format</FieldLabel>
                <Select value={dateFormat} onValueChange={(value) => setDateFormat(value as typeof dateFormat)}><SelectTrigger id="import-date-format" className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectGroup>
                  <SelectItem value="MM/DD/YYYY">MM/DD/YYYY</SelectItem><SelectItem value="DD/MM/YYYY">DD/MM/YYYY</SelectItem><SelectItem value="YYYY-MM-DD">YYYY-MM-DD</SelectItem>
                </SelectGroup></SelectContent></Select><FieldDescription>Contacts display dates as MM/DD/YYYY. ISO dates (YYYY-MM-DD) also work.</FieldDescription>
              </Field>
              <Field><FieldLabel htmlFor="import-phone-country">Default phone country</FieldLabel>
                <Select value={phoneCountry} onValueChange={setPhoneCountry}><SelectTrigger id="import-phone-country" className="w-full"><SelectValue placeholder="Choose a country" /></SelectTrigger><SelectContent><SelectGroup>
                  {COUNTRY_OPTIONS.map(({ code, name, callingCode }) => <SelectItem key={code} value={code}>{countryFlag(code)} {name} (+{callingCode})</SelectItem>)}
                </SelectGroup></SelectContent></Select>
                <FieldDescription>Choose by country name and flag. This formats CSV numbers that do not include a country code.</FieldDescription>
              </Field>
              <Field><FieldLabel htmlFor="import-separator">Multi-select separator</FieldLabel><Input id="import-separator" maxLength={4} value={multiSelectSeparator} onChange={(event) => setMultiSelectSeparator(event.target.value)} /></Field>
              <Field><FieldLabel htmlFor="import-default-status">Default contact status</FieldLabel>
                <Select value={defaultStatusConfigId} onValueChange={setDefaultStatusConfigId}><SelectTrigger id="import-default-status" className="w-full"><SelectValue placeholder="Choose a status" /></SelectTrigger><SelectContent><SelectGroup>
                  {preview.catalog.statuses.map((status) => <SelectItem key={status.id} value={status.id}>{status.name}</SelectItem>)}
                </SelectGroup></SelectContent></Select>
              </Field>
            </div>
            <div>
              <h2 className="mb-2 text-sm font-semibold text-slate-900">Sample rows</h2>
              <p className="mb-2 text-xs text-muted-foreground">Mapped dates and phone numbers are shown as they will appear in contacts.</p>
              <div className="max-h-72 overflow-auto rounded-xl border border-slate-200">
                <Table><TableHeader><TableRow>{preview.headers.map((header, index) => <TableHead key={index}>{header}</TableHead>)}</TableRow></TableHeader>
                  <TableBody>{preview.sampleRows.slice(0, 5).map((row, rowIndex) => <TableRow key={rowIndex}>{preview.headers.map((_, index) => {
                    const raw = row[index] ?? ""
                    const target = mappings[index]?.target
                    const customType = target?.kind === "CUSTOM_FIELD" ? preview.catalog.customFields.find((field) => field.id === target.fieldId)?.fieldType : null
                    const isPhone = target?.kind === "CONTACT_FIELD" && PHONE_KEYS.has(target.key) || customType === "PHONE"
                    const isDate = target?.kind === "CONTACT_FIELD" && DATE_KEYS.has(target.key) || customType === "DATE"
                    const shown = isPhone ? formatSamplePhone(raw, phoneCountry) : isDate ? formatSampleDate(raw, dateFormat) : raw
                    return <TableCell key={index} className="max-w-56 truncate" title={shown !== raw ? `CSV: ${raw}` : undefined}>{shown}</TableCell>
                  })}</TableRow>)}</TableBody></Table>
              </div>
            </div>
            {mappingError ? <p role="alert" className="text-sm text-amber-700">{mappingError}</p> : null}
            <div className="flex justify-end"><Button disabled={Boolean(mappingError) || busy || hasActiveImport} onClick={() => void queueImport()}>
              {busy ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <UploadCloud data-icon="inline-start" />}
              Queue import
            </Button></div>
          </CardContent>
        </Card>
      ) : null}

      {step === "progress" && selected ? (
        <Card className="rounded-[24px] border-slate-200"><CardHeader><CardTitle>{selected.fileName}</CardTitle><CardDescription>Import continues while you use the rest of the app.</CardDescription></CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2"><Badge variant="secondary">{labelForStatus(selected.status)}</Badge>{selected.phase ? <span className="text-sm text-slate-500">{labelForStatus(selected.phase)}</span> : null}</div>
            <Progress value={selected.totalRows ? selected.processedRows / selected.totalRows * 100 : 0} />
            <p className="text-sm text-slate-600">{selected.processedRows.toLocaleString()} of {selected.totalRows ? selected.totalRows.toLocaleString() : "…"} rows processed</p>
            <div className="grid gap-3 sm:grid-cols-3">{[["Created", selected.createdRows], ["Duplicates", selected.duplicateRows], ["Invalid", selected.invalidRows]].map(([label, count]) => <div key={label} className="rounded-xl bg-slate-50 p-3"><p className="text-xs text-slate-500">{label}</p><p className="text-xl font-semibold text-slate-950">{Number(count).toLocaleString()}</p></div>)}</div>
            {selected.lastError ? <p role="alert" className="text-sm text-red-700">{selected.lastError}</p> : null}
            <div className="flex flex-wrap gap-2">
              {selected.hasReport ? <Button variant="outline" onClick={() => void downloadReport(selected)}><Download data-icon="inline-start" /> Download issue CSV</Button> : null}
              {ACTIVE_STATUSES.has(selected.status) ? <Button variant="outline" onClick={() => void cancelImport(selected)}><XCircle data-icon="inline-start" /> Cancel import</Button> : null}
              {!ACTIVE_STATUSES.has(selected.status) ? <Link className="inline-flex items-center gap-2 text-sm font-semibold text-blue-900 hover:underline" href={`/app/${tenantSlug}/contacts`}><CheckCircle2 className="size-4" /> View contacts</Link> : null}
            </div>
          </CardContent></Card>
      ) : null}

      <Card className="rounded-[24px] border-slate-200"><CardHeader><CardTitle>Import history</CardTitle><CardDescription>Recent jobs for this account. Select one to see its progress and report.</CardDescription></CardHeader>
        <CardContent>{jobs.length ? <div className="flex flex-col gap-2">{jobs.map((job) => <button key={job.id} type="button" onClick={() => { setSelectedId(job.id); setStep("progress") }} className="flex w-full flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 px-4 py-3 text-left transition hover:bg-slate-50">
          <span className="min-w-0"><span className="block truncate text-sm font-semibold text-slate-900">{job.fileName}</span><span className="text-xs text-slate-500">{new Date(job.createdAt).toLocaleString()}</span></span>
          <span className="flex items-center gap-3"><span className="text-xs text-slate-600">{job.createdRows.toLocaleString()} created</span><Badge variant="secondary">{labelForStatus(job.status)}</Badge></span>
        </button>)}</div> : <p className="text-sm text-slate-500">No imports yet.</p>}</CardContent></Card>
    </section>
  )
}
