<?php
// The Bun Sheet mark (brand board "Marks"): 16 px is the menu icon (outline + one ketchup dash), 48 px the empty
// state (folds dotted, the cut dashed). Outline in currentColor so it follows the theme; decorative, so hidden.
$size = (int) ($size ?? 16);
?>
<?php if ($size >= 48): ?>
<svg class="hotdogpress-mark" width="48" height="48" viewBox="0 0 48 48" aria-hidden="true" focusable="false"><rect x="3" y="10" width="42" height="28" rx="8" fill="#FAF7F0" stroke="#1B1A17" stroke-width="3"/><g stroke="#1B1A17" stroke-width="1.5" stroke-dasharray="1 3"><line x1="13.5" y1="12" x2="13.5" y2="36"/><line x1="24" y1="12" x2="24" y2="36"/><line x1="34.5" y1="12" x2="34.5" y2="36"/></g><line x1="13.5" y1="24" x2="34.5" y2="24" stroke="#C8322B" stroke-width="4" stroke-linecap="round" stroke-dasharray="6 3"/></svg>
<?php else: ?>
<svg class="hotdogpress-icon" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false" style="vertical-align: -0.2em; margin-right: 0.3em"><rect x="1" y="3" width="14" height="10" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.5"/><line x1="5" y1="8" x2="11" y2="8" stroke="#C8322B" stroke-width="2" stroke-linecap="round"/></svg>
<?php endif ?>
