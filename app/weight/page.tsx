import Container from "@mui/material/Container";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Paper from "@mui/material/Paper";
import MonitorWeightOutlinedIcon from "@mui/icons-material/MonitorWeightOutlined";
import { getActiveProfile } from "@/lib/profile";
import { canEditProfile } from "@/lib/auth";
import { getWeightDashboard } from "@/lib/queries/weight";
import WeightActions from "@/components/weight/WeightActions";
import WeightBody from "@/components/weight/WeightBody";
import YearSwitcher from "@/components/weight/YearSwitcher";
import Wrapped from "@/components/weight/Wrapped";

export const metadata = { title: "Weight" };

const DEFAULT_ACCENT = "#4f86e0";

export default async function WeightDashboard({
  searchParams,
}: {
  searchParams: Promise<{ profile?: string; year?: string }>;
}) {
  const { profile, year } = await searchParams;
  const active = await getActiveProfile(profile);

  if (!active) {
    return (
      <Container maxWidth="md" sx={{ py: 6 }}>
        <Typography color="text.secondary">
          No profiles yet — add someone to start tracking weight.
        </Typography>
      </Container>
    );
  }

  const [dash, editor] = await Promise.all([
    getWeightDashboard(active.id, year ? Number(year) : undefined),
    canEditProfile(active.id),
  ]);
  const {
    plan,
    weighIns,
    stats,
    chart,
    trends,
    projections,
    planPaceLbPerWeek,
    goalDate,
    milestones,
    yearSummary,
    year: viewYear,
    availableYears,
    celebrate,
  } = dash;
  const accent = active.color ?? DEFAULT_ACCENT;

  // "Today" computed on the server so the log modal's date hydrates cleanly.
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  const todayISO = now.toISOString().slice(0, 10);
  const isCurrentYear = viewYear === now.getFullYear();

  return (
    <Container maxWidth="md" sx={{ py: { xs: 4, md: 6 } }}>
      <Stack
        direction="row"
        alignItems="flex-start"
        justifyContent="space-between"
        spacing={2}
        sx={{ mb: 3 }}
      >
        <Stack spacing={0.5}>
          <Typography variant="h3" component="h1">
            Weight
          </Typography>
          <Typography variant="h6" component="p" color="text.secondary" fontWeight={400}>
            {active.name}
            {plan
              ? ` · goal ${Number(plan.goalWeight)} lb`
              : isCurrentYear
                ? " · no plan set yet"
                : ""}
          </Typography>
        </Stack>
        {editor && isCurrentYear ? (
          <WeightActions
            profileId={active.id}
            defaultDate={todayISO}
            hasPlan={!!plan}
            mode={(plan?.mode as "lose" | "maintain" | undefined) ?? undefined}
            currentWeight={stats?.current ?? null}
            startWeight={plan ? Number(plan.startWeight) : null}
            startDate={plan?.startDate ?? null}
            goalWeight={plan ? Number(plan.goalWeight) : null}
            perWeekPace={plan ? Number(plan.perWeekPace) : null}
            endDate={plan?.endDate ?? null}
            rangeLb={plan?.rangeLb != null ? Number(plan.rangeLb) : null}
          />
        ) : !isCurrentYear && yearSummary ? (
          <Wrapped summary={yearSummary} accent={accent} mode="button" />
        ) : null}
      </Stack>

      {availableYears.length > 1 ? (
        <Stack direction="row" sx={{ mb: 3 }}>
          <YearSwitcher years={availableYears} current={viewYear} profile={profile} />
        </Stack>
      ) : null}

      {celebrate ? <Wrapped summary={celebrate} accent={accent} mode="celebrate" /> : null}

      {weighIns.length === 0 || !stats ? (
        <Paper variant="outlined" sx={{ p: 5, textAlign: "center" }}>
          <MonitorWeightOutlinedIcon sx={{ fontSize: 44, color: "text.disabled", mb: 1 }} />
          <Typography color="text.secondary">
            {editor
              ? "No weigh-ins yet — hit Log to start the chart."
              : "No weigh-ins logged yet."}
          </Typography>
        </Paper>
      ) : (
        <WeightBody
          stats={stats}
          hasGoal={!!plan}
          planPace={planPaceLbPerWeek}
          color={accent}
          dates={chart.dates}
          actual={chart.actual}
          target={chart.target}
          movingAvg={chart.movingAvg}
          bandLow={chart.bandLow}
          bandHigh={chart.bandHigh}
          ghost={chart.ghost}
          holdWeight={plan?.mode === "maintain" ? Number(plan.goalWeight) : null}
          holdRange={plan?.rangeLb != null ? Number(plan.rangeLb) : null}
          goalWeight={plan && plan.mode !== "maintain" ? Number(plan.goalWeight) : null}
          goalDate={goalDate}
          trends={trends}
          projections={projections}
          milestones={milestones!}
        />
      )}
    </Container>
  );
}
