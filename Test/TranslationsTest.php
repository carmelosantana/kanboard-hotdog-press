<?php
require_once 'tests/units/Base.php';

use KanboardTests\units\Base;

// Every string the plugin translates has a Spanish entry, nothing in es_ES is stale, and no string carries a lone
// `%` (t() and e() run sprintf, so a literal percent must be `%%`). Strings are found in the source: t('…') and
// e('…') calls, plus ZineRejected messages, which the pages flash through t().
class TranslationsTest extends Base
{
    private const ROOT = __DIR__.'/..';

    /** @return array<string, string> key => first place it is used */
    private static function sourceKeys(): array
    {
        $files = array_merge(
            [self::ROOT.'/Plugin.php'],
            glob(self::ROOT.'/Controller/*.php'),
            glob(self::ROOT.'/Model/*.php'),
            glob(self::ROOT.'/Template/*/*.php'),
        );
        $string = "'((?:[^'\\\\]|\\\\.)*)'";
        $keys = [];
        foreach ($files as $file) {
            $src = file_get_contents($file);
            preg_match_all("/(?<![\\w>$])[te]\\(\\s*$string/", $src, $calls);
            preg_match_all("/ZineRejected\\('\\w+',\\s*$string/", $src, $refusals);
            foreach (array_merge($calls[1], $refusals[1]) as $raw) {
                $keys[str_replace(["\\'", '\\\\'], ["'", '\\'], $raw)] ??= basename(dirname($file)).'/'.basename($file);
            }
        }
        return $keys;
    }

    private static function spanish(): array
    {
        return require self::ROOT.'/Locale/es_ES/translations.php';
    }

    /** sprintf conversions in order, after dropping the escaped `%%`. */
    private static function placeholders(string $s): array
    {
        preg_match_all('/%(?:\d+\$)?[sd]/', str_replace('%%', '', $s), $m);
        return $m[0];
    }

    public function testFindsTheTemplateAndConfigStrings(): void
    {
        $keys = self::sourceKeys();
        $this->assertArrayHasKey('No zines yet', $keys);
        $this->assertArrayHasKey('Print at Actual size (100%%), on %s, one side.', $keys);
        $this->assertArrayHasKey('Only JPEG, PNG and WebP images are accepted.', $keys);
        $this->assertGreaterThan(60, count($keys));
    }

    public function testEveryKeyHasASpanishEntry(): void
    {
        $es = self::spanish();
        $missing = array_diff_key(self::sourceKeys(), $es);
        $this->assertSame([], $missing, 'missing es_ES entries');
    }

    public function testNoStaleSpanishEntries(): void
    {
        $this->assertSame([], array_keys(array_diff_key(self::spanish(), self::sourceKeys())), 'unused es_ES entries');
    }

    public function testNoLonePercentAndPlaceholdersMatch(): void
    {
        foreach (self::spanish() as $key => $value) {
            foreach ([$key, $value] as $s) {
                $this->assertDoesNotMatchRegularExpression('/%(?!(?:\d+\$)?[sd])/', str_replace('%%', '', $s), "lone % in: $s");
            }
            $this->assertNotSame('', trim($value), "empty translation for: $key");
            $this->assertSame(self::placeholders($key), self::placeholders($value), "placeholders differ: $key");
        }
    }
}
