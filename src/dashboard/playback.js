export function stopAtBoundary(player, end) {
  if (!Number.isFinite(end) || player.currentTime < end) return false;
  player.currentTime = end;
  player.pause();
  return true;
}
