import { Bar, BarChart, LabelList, XAxis, YAxis } from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart'

/** One bar. `color` is a CSS colour, e.g. `var(--series-1)`, kept with its entity. */
export type CountBar = { label: string; count: number; color: string }

const count = new Intl.NumberFormat('en')

// Names the value in the tooltip. Each bar's colour comes with the bar, not
// from here: no legend, since every bar is named beside it.
const chartConfig = {
  count: { label: 'Tickets' },
} satisfies ChartConfig

// Each bar gets a 36px row: a 20px bar, thin enough not to read as a block,
// with room above and below it for the label beside it.
const BAR_ROW_HEIGHT = 36

type CountBarChartProps = {
  heading: string
  bars: CountBar[]
  total: number
}

/**
 * Ticket counts as horizontal bars, each labelled with its number. Horizontal
 * so the names sit on one line at any width.
 *
 * The chart is drawn for sighted readers and hidden from assistive tech, which
 * reads the same numbers from the list beside it: an SVG of bars announces
 * nothing useful on its own.
 */
export default function CountBarChart({ heading, bars, total }: CountBarChartProps) {
  return (
    <Card aria-label={heading} role="region">
      <CardHeader>
        <CardTitle>
          <h2>
            {heading}{' '}
            <span className="font-normal text-muted-foreground">
              of {count.format(total)} {total === 1 ? 'ticket' : 'tickets'}
            </span>
          </h2>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="sr-only">
          {bars.map((bar) => (
            <div key={bar.label}>
              <dt>{bar.label}</dt>
              <dd>{count.format(bar.count)}</dd>
            </div>
          ))}
        </dl>
        <ChartContainer
          aria-hidden="true"
          className="aspect-auto w-full"
          config={chartConfig}
          style={{ height: bars.length * BAR_ROW_HEIGHT }}
        >
          {/* fill on each row is what Recharts paints that bar with. */}
          <BarChart
            data={bars.map((bar) => ({ ...bar, fill: bar.color }))}
            layout="vertical"
            margin={{ left: 0, right: 48 }}
          >
            <XAxis dataKey="count" hide type="number" />
            <YAxis axisLine={false} dataKey="label" tickLine={false} type="category" width={128} />
            <ChartTooltip content={<ChartTooltipContent />} cursor={false} />
            <Bar barSize={20} dataKey="count" radius={4}>
              <LabelList
                className="fill-foreground"
                dataKey="count"
                formatter={(value) => count.format(Number(value))}
                position="right"
              />
            </Bar>
          </BarChart>
        </ChartContainer>
      </CardContent>
    </Card>
  )
}
