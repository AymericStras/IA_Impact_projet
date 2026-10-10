export function safeURL(value) {
  try { const u = new URL(value); return ['https:', 'http:'].includes(u.protocol) && !u.username && !u.password ? u.href : null; } catch { return null; }
}
export function addDays(value, amount) {
  const d = new Date(`${value}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + amount); return d.toISOString().slice(0, 10);
}
export function stamp(value) {
  if (!value) return 'Not published';
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const d = new Date(value); return Number.isNaN(d.getTime()) ? 'Needs review' : new Intl.DateTimeFormat('en-GB', {timeZone:'Europe/Paris',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(d);
}
export function slotLabel(s) {
  if (!s || s.precision === 'unknown') return 'Time not published';
  const start = s.start_at || s.start_date, end = s.end_at || s.end_date;
  return stamp(start) + (end && end !== start ? ` — ${stamp(end)}` : '');
}
export const statuses = {scheduled:'Scheduled',rescheduled:'Rescheduled',postponed:'Postponed',cancelled:'Cancelled',full:'Full',moved_online:'Moved online',unknown:'Status unverified',queued:'Queued',running:'Reading',pending:'Incomplete',paused:'Paused; can resume',complete:'Reached final page',partial:'Final page reached; records need review',failed:'Reading failed',not_checked:'Dates not checked',cancelled_job:'Stopped'};
export const errors = {walking_budget_reached:"This batch reached its route limit. Resume to continue.",user_paused:'Paused at your request. You can resume.',pagination_cycle:'The source repeated a pagination cursor. Collection stopped; review the source before retrying.',page_budget_reached:'The page limit for this batch was reached. Resume to continue.',hourly_budget_or_cooldown:'The hourly quota or a source cooldown was reached. Try again later.',storage_budget_reached:'Collection paused at the storage limit. Saved data remains searchable.',local_app_stopped:'The previous application session ended. Progress was saved.',endpoint_config_changed:'Source configuration changed. Start a new refresh.',http_429:'The source requested fewer requests. Try again later.',configuration_or_access_error:'Check source configuration, permission expiry or credentials.',network_or_storage_error:'Network or storage is temporarily unavailable.',database_writer_busy_or_configuration_error:'Another writer is active, or configuration needs review.',invalid_request_or_writer_busy:'Request incomplete. Check the date range and retry later; another writer may be active.',read_only_preview:'This viewer is read-only. Collection is not enabled here.',invalid_query_or_export_over_2000:'Check the filters. Use at most 366 days and 2,000 records per export; narrow the selection if needed.',database_busy_or_upgrade_required:'The database is busy or needs upgrading. Try again later.',disk_space_low:'Updates paused because free disk space is low.'};
export function errorText(code) { return errors[code] || 'The operation did not complete. Saved data is intact. Check the source or retry later.'; }

export function railLabel(rail) {
  if (!rail || rail.status === 'unknown') return 'Walking route unverified';
  if (rail.status === 'outside') return 'Over 20 minutes (current stations and model)';
  if (rail.status !== 'within_20_min' || !Number.isFinite(rail.walking_seconds)) return 'Walking route unverified';
  return `${rail.station_name} · Approx. ${Math.ceil(rail.walking_seconds/60)} min / ${rail.walking_metres} m`;
}
export const railReasons = {
  event_moved_online:'The source moved this event online. Previous venue coordinates do not establish in-person access.',
  coordinates_missing:'Venue coordinates are missing or invalid. Verify the actual location.',
  station_registry_missing:'No verified station registry has been imported.',
  route_unverified_or_unavailable:'The route is unchecked, expired, or unavailable from the routing service.',
  other_candidate_routes_unverified:'Checked routes exceed 20 minutes; other candidate stations remain unchecked.',
  no_station_within_model_radius:'No station in the current registry can meet the 20-minute limit under the 4 km/h model.',
  all_candidate_routes_over_limit:'All candidate station routes exceed 20 minutes.',
  pedestrian_route_estimate:'The estimated route qualifies. Recheck entrances, paths and group speed before travel.'
};
