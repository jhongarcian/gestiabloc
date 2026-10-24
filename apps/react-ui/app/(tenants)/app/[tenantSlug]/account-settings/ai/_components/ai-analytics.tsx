"use client"

import { useId, useState } from "react"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { AiPageHeader, AiPanel } from "./ai-ui"

const periods = {
  "7": {
    labels: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
    values: [18, 26, 21, 38, 32, 24, 30],
    unit: "Day",
  },
  "30": {
    labels: ["Week 1", "Week 2", "Week 3", "Week 4"],
    values: [118, 163, 142, 189],
    unit: "Week",
  },
  "90": {
    labels: [
      "Week 1",
      "Week 2",
      "Week 3",
      "Week 4",
      "Week 5",
      "Week 6",
      "Week 7",
      "Week 8",
      "Week 9",
      "Week 10",
      "Week 11",
      "Week 12",
      "Week 13",
    ],
    values: [78, 95, 88, 118, 110, 133, 126, 153, 146, 175, 163, 184, 198],
    unit: "Week",
  },
} as const

export function AiAnalytics() {
  const [period, setPeriod] = useState<keyof typeof periods>("30")
  const gradientId = `usage-${useId().replace(/:/g, "")}`
  const data = periods[period]
  const total = data.values.reduce(
    (sum: number, value: number) => sum + value,
    0,
  )
  const metrics = [
    {
      label: "Conversations",
      value: total,
      description: "Sample conversations with your helper.",
    },
    {
      label: "Questions answered",
      value: Math.round(total * 1.7),
      description: "Example answers across all skills.",
    },
    {
      label: "Qualification checks",
      value: Math.round(total * 0.42),
      description: "Sample service readiness reviews.",
    },
    {
      label: "Team handoffs",
      value: Math.round(total * 0.14),
      description: "Example conversations passed to your team.",
    },
  ]
  const maximum = Math.ceil(Math.max(...data.values) / 20) * 20
  const points = data.values.map((value, index) => ({
    x: 48 + index * (600 / (data.values.length - 1)),
    y: 200 - (value / maximum) * 160,
    value,
    label: data.labels[index],
  }))
  const line = points.map(({ x, y }) => `${x},${y}`).join(" ")
  const labelStep = period === "90" ? 3 : 1
  return (
    <>
      <AiPageHeader
        title="Analytics"
        description="Explore how helper activity and service conversations could appear."
        actions={
          <ToggleGroup
            type="single"
            spacing={1}
            value={period}
            onValueChange={(value) => {
              if (value in periods) setPeriod(value as keyof typeof periods)
            }}
            aria-label="Sample analytics period"
            className="rounded-full border border-slate-200 bg-white/70 p-1"
          >
            {(["7", "30", "90"] as const).map((value) => (
              <ToggleGroupItem
                key={value}
                value={value}
                className="h-8 rounded-full px-3 text-xs font-semibold text-slate-600 data-[state=on]:bg-white data-[state=on]:text-blue-950 data-[state=on]:shadow-sm"
              >
                {value} days
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-4">
          {metrics.map((metric) => (
            <Card
              key={metric.label}
              className="min-w-0 gap-0 rounded-[22px] border-white/80 bg-white/70 py-0 shadow-sm"
            >
              <CardHeader className="gap-0 px-4 pt-4 pb-0">
                <CardTitle className="text-xs font-semibold text-slate-500">
                  {metric.label}
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pt-2 pb-4">
                <p className="text-xl font-semibold tabular-nums text-slate-950">
                  {metric.value.toLocaleString("en-US")}
                </p>
                <CardDescription className="mt-1 text-xs">
                  {metric.description}
                </CardDescription>
              </CardContent>
            </Card>
          ))}
        </div>
      </AiPageHeader>
      <AiPanel
        title="Conversation activity"
        description={`Fictional activity over a ${period}-day period.`}
        actions={<Badge variant="secondary">Sample data</Badge>}
      >
        <figure className="min-w-0">
          <svg
            viewBox="0 0 696 240"
            className="h-auto w-full"
            role="img"
            aria-labelledby={`${gradientId}-title ${gradientId}-description`}
          >
            <title id={`${gradientId}-title`}>
              Sample conversation activity over {period} days
            </title>
            <desc id={`${gradientId}-description`}>
              Fictional usage values, available in the accompanying table.
            </desc>
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#dbeafe" stopOpacity="0.85" />
                <stop offset="100%" stopColor="#eff6ff" stopOpacity="0.15" />
              </linearGradient>
            </defs>
            {[0, 1, 2, 3, 4].map((tick) => (
              <g key={tick}>
                <line
                  x1="48"
                  x2="648"
                  y1={200 - tick * 40}
                  y2={200 - tick * 40}
                  stroke="#e2e8f0"
                  strokeDasharray="4 5"
                />
                <text
                  x="36"
                  y={204 - tick * 40}
                  textAnchor="end"
                  fontSize="11"
                  fill="#64748b"
                >
                  {(maximum * tick) / 4}
                </text>
              </g>
            ))}
            <polygon
              points={`48,200 ${line} 648,200`}
              fill={`url(#${gradientId})`}
            />
            <polyline
              points={line}
              fill="none"
              stroke="#172554"
              strokeWidth="2.5"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            {points.map((point, index) => (
              <g key={point.label}>
                <circle
                  cx={point.x}
                  cy={point.y}
                  r="3.5"
                  fill="#fff"
                  stroke="#172554"
                  strokeWidth="2"
                >
                  <title>
                    {point.label}: {point.value} conversations
                  </title>
                </circle>
                {index % labelStep === 0 || index === points.length - 1 ? (
                  <text
                    x={point.x}
                    y="226"
                    fontSize="11"
                    textAnchor="middle"
                    fill="#64748b"
                  >
                    {point.label}
                  </text>
                ) : null}
              </g>
            ))}
          </svg>
          <figcaption className="mt-3 text-xs leading-5 text-slate-500">
            Preview only. These figures are fictional and do not represent
            account usage.
          </figcaption>
          <table className="sr-only">
            <caption>Sample conversations for the {period}-day period</caption>
            <thead>
              <tr>
                <th scope="col">{data.unit}</th>
                <th scope="col">Conversations</th>
              </tr>
            </thead>
            <tbody>
              {points.map((point) => (
                <tr key={point.label}>
                  <th scope="row">{point.label}</th>
                  <td>{point.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </figure>
      </AiPanel>
    </>
  )
}
