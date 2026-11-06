export type DashboardRun = {
  status: string;
  current_stage?: string | null;
  processed_count?: number | null;
  source_count?: number | null;
  current_file?: string | null;
};

export function dashboardStatus(run?: DashboardRun) {
  if (!run) return 'analysis: idle';
  const progress =
    run.processed_count === null || run.source_count === null
      ? ''
      : ` ${run.processed_count}/${run.source_count}`;
  return `analysis: ${run.status}${run.current_stage ? ` · ${run.current_stage}` : ''}${progress}${run.current_file ? ` · ${run.current_file}` : ''}`;
}
