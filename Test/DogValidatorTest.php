<?php
require_once 'tests/units/Base.php';

use KanboardTests\units\Base;
use Kanboard\Plugin\HotDogPress\Model\DogValidator;
use PHPUnit\Framework\Attributes\DataProvider;

// The PHP mirror of Assets/js/core/dog.js validateDog: same fixtures, same paths, same messages.
class DogValidatorTest extends Base
{
    private const DIR = __DIR__.'/fixtures/dog/';

    private static function load(string $name): array
    {
        return json_decode(file_get_contents(self::DIR.$name), true, 512, JSON_THROW_ON_ERROR);
    }

    /** A fixture's Dog as the save endpoint reads JSON: DogValidator::decode keeps [] apart from {}. */
    private static function dog(string $name): mixed
    {
        $raw = json_decode(file_get_contents(self::DIR.$name), false, 512, JSON_THROW_ON_ERROR);
        return DogValidator::normalize(str_starts_with($name, 'valid-') ? $raw : $raw->dog);
    }

    private static function fixtures(string $prefix): array
    {
        $rows = [];
        foreach (glob(self::DIR.$prefix.'*.json') as $path) {
            $rows[basename($path)] = [basename($path)];
        }
        ksort($rows);
        return $rows;
    }

    public static function validFixtures(): array
    {
        return self::fixtures('valid-');
    }

    public static function invalidFixtures(): array
    {
        return self::fixtures('invalid-');
    }

    public function testTheFixtureDirectoryHasBothKinds(): void
    {
        $this->assertGreaterThanOrEqual(2, count(self::validFixtures()));
        $this->assertGreaterThanOrEqual(15, count(self::invalidFixtures()));
    }

    public function testDecodeKeepsAJsonArrayApartFromAnObjectWhereDogOneHasObjects(): void
    {
        $this->assertSame(['assets' => [], 'pages' => []], DogValidator::decode('{"assets":{},"pages":[]}'));
        $this->assertSame(['assets' => false], DogValidator::decode('{"assets":[]}'));
        $this->assertSame(['assets' => ['a' => false, 'b' => []]], DogValidator::decode('{"assets":{"a":[],"b":{}}}'));
        $this->assertNull(DogValidator::decode('[]'));
        $this->assertNull(DogValidator::decode('"x"'));
        $this->assertNull(DogValidator::decode('{'));
    }

    public function testADogMayHoldExactlyMaxAssetsAssets(): void
    {
        $this->assertSame(500, DogValidator::MAX_ASSETS);
        $dog = self::dog('valid-minimal.json');
        $dog['assets'] = [];
        for ($i = 0; $i < DogValidator::MAX_ASSETS; $i++) {
            $dog['assets']['a'.$i] = ['kind' => 'placeholder'];
        }
        $this->assertSame([], DogValidator::validate($dog, 'strict')['errors'] ?? []);
    }

    /** @dataProvider validFixtures */
    #[DataProvider('validFixtures')]
    public function testValidFixturePassesBothModes(string $name): void
    {
        foreach (['lenient', 'strict'] as $mode) {
            $res = DogValidator::validate(self::dog($name), $mode);
            $this->assertSame([], $res['errors'] ?? [], $mode);
            $this->assertTrue($res['ok'], $mode);
            $this->assertSame(1, $res['dog']['hotdog'], $mode);
        }
    }

    /** @dataProvider invalidFixtures */
    #[DataProvider('invalidFixtures')]
    public function testInvalidFixtureReportsExactlyItsErrors(string $name): void
    {
        $fixture = self::load($name);
        $dog = self::dog($name);
        $res = DogValidator::validate($dog, $fixture['mode']);
        $this->assertFalse($res['ok']);
        $this->assertSame($fixture['errors'], $res['errors']);
        if ($fixture['mode'] === 'lenient') {
            $this->assertSame($fixture['errors'], DogValidator::validate($dog, 'strict')['errors']);
        } else {
            $lenient = DogValidator::validate($dog, 'lenient');
            $this->assertTrue($lenient['ok']);
            $this->assertSame($fixture['dog'], $lenient['dog']);
        }
    }

    public function testFieldListsAndEnumsMatchTheSharedFieldsJson(): void
    {
        $this->assertSame(self::load('fields.json'), DogValidator::FIELDS + [
            'papers' => DogValidator::PAPERS,
            'layouts' => DogValidator::LAYOUTS,
            'by' => DogValidator::BY,
        ]);
    }

    public function testMigrateTreatsAMissingVersionAsZeroAndBringsItToOne(): void
    {
        $old = self::load('valid-legacy-no-version.json');
        $migrated = DogValidator::migrate($old);
        $this->assertSame(1, $migrated['hotdog']);
        $this->assertSame('hotdog', array_key_first($migrated));
        unset($migrated['hotdog']);
        $this->assertSame($old, $migrated);
        $this->assertSame(1, DogValidator::migrate(['hotdog' => 0] + $old)['hotdog']);
        $this->assertSame(7, DogValidator::migrate(['hotdog' => 7] + $old)['hotdog']);
    }

    public function testTheWholeDogIsAtMostTwoMegabytesOfJson(): void
    {
        $this->assertSame(2097152, DogValidator::MAX_BYTES);
        $dog = self::load('valid-minimal.json');
        $overhead = strlen(json_encode(['title' => ''] + $dog, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE));
        $fits = ['title' => str_repeat('a', DogValidator::MAX_BYTES - $overhead)] + $dog;
        $this->assertTrue(DogValidator::validate($fits, 'strict')['ok']);
        // 'é' is two UTF-8 bytes and must not be escaped to six (é) when measured.
        $over = ['title' => str_repeat('é', intdiv(DogValidator::MAX_BYTES - $overhead, 2) + 1)] + $dog;
        $this->assertSame(
            [['path' => '', 'message' => 'must be at most 2097152 bytes of JSON']],
            DogValidator::validate($over, 'strict')['errors']
        );
        $justUnder = ['title' => str_repeat('é', intdiv(DogValidator::MAX_BYTES - $overhead, 2))] + $dog;
        $this->assertTrue(DogValidator::validate($justUnder, 'strict')['ok']);
    }

    public function testErrorPathEscapesTildeAndSlashLikeAJsonPointer(): void
    {
        $dog = self::load('valid-minimal.json');
        $dog['assets'] = ['a/1~' => ['kind' => 'image', 'file_id' => 1, 'w' => 1, 'h' => 1, 'extra' => 1]];
        $this->assertSame(
            [['path' => 'assets/a~11~0/extra', 'message' => 'unknown field']],
            DogValidator::validate($dog, 'strict')['errors']
        );
    }
}
