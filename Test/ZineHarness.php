<?php

use Kanboard\Core\Http\Request;
use Kanboard\Core\Http\Response;
use Kanboard\Core\ObjectStorage\FileStorage;
use Kanboard\Core\Security\Role;
use Kanboard\Plugin\HotDogPress\Model\ZineModel;
use Kanboard\Plugin\HotDogPress\Plugin;

// Shared setup for the HotDogPress tests: the schema, a real file store in a temp dir, the plugin's routes and
// access map, project "Zines" with a viewer, a member and a manager, project "Other" managed by an outsider, and
// a Response whose send() is stubbed so status, headers and body can be read back.
trait ZineHarness
{
    private int $project;
    private int $otherProject;
    /** @var array<string, int> */
    private array $users = [];
    private string $storeDir;
    private string $uploadDir;

    private function setUpZines(): void
    {
        require_once __DIR__.'/../Schema/'.['sqlite' => 'Sqlite', 'mysql' => 'Mysql', 'postgres' => 'Postgres'][DB_DRIVER].'.php';
        \Kanboard\Plugin\HotDogPress\Schema\version_1($this->container['db']->getConnection());
        $this->container['logger'] = $this->createMock(\Psr\Log\LoggerInterface::class);
        $this->storeDir = sys_get_temp_dir().'/hotdogpress-store-'.bin2hex(random_bytes(6));
        $this->uploadDir = sys_get_temp_dir().'/hotdogpress-up-'.bin2hex(random_bytes(6));
        mkdir($this->storeDir);
        mkdir($this->uploadDir);
        $this->container['objectStorage'] = new FileStorage($this->storeDir);
        (new Plugin($this->container))->initialize();

        $this->project = (int) $this->container['projectModel']->create(['name' => 'Zines']);
        $this->otherProject = (int) $this->container['projectModel']->create(['name' => 'Other']);
        foreach (['viewer' => Role::PROJECT_VIEWER, 'member' => Role::PROJECT_MEMBER, 'manager' => Role::PROJECT_MANAGER] as $name => $role) {
            $this->users[$name] = (int) $this->container['userModel']->create(['username' => $name]);
            $this->container['projectUserRoleModel']->addUser($this->project, $this->users[$name], $role);
        }
        $this->users['outsider'] = (int) $this->container['userModel']->create(['username' => 'outsider']);
        $this->container['projectUserRoleModel']->addUser($this->otherProject, $this->users['outsider'], Role::PROJECT_MANAGER);
    }

    private function tearDownZines(): void
    {
        foreach ([$this->storeDir, $this->uploadDir] as $dir) {
            if (is_dir($dir)) {
                $files = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($dir, FilesystemIterator::SKIP_DOTS), RecursiveIteratorIterator::CHILD_FIRST);
                foreach ($files as $f) {
                    $f->isDir() ? rmdir($f->getPathname()) : unlink($f->getPathname());
                }
                rmdir($dir);
            }
        }
    }

    private function zines(): ZineModel
    {
        return new ZineModel($this->container);
    }

    private function loginAs(string $name): void
    {
        $this->container['userSession']->initialize($this->container['userModel']->getById($this->users[$name]));
        $this->container['memoryCache']->flush();
    }

    /** A Dog fixture as decoded JSON (with an optional title), or its JSON text. */
    private function dog(string $fixture = 'valid-minimal', array $set = []): array
    {
        return array_replace(json_decode(file_get_contents(__DIR__."/fixtures/dog/$fixture.json"), true), $set);
    }

    private function dogJson(string $fixture = 'valid-minimal', array $set = []): string
    {
        $dog = $this->dog($fixture, $set);
        $dog['assets'] = (object) $dog['assets']; // keep {} an object, as the browser sends it
        return json_encode($dog, JSON_UNESCAPED_SLASHES);
    }

    /** A zine in $project created by the member, with the minimal Dog. */
    private function makeZine(?int $project = null, string $title = 'First issue'): int
    {
        return $this->zines()->create($project ?? $this->project, $title, $this->dogJson(), $this->users['member']);
    }

    /** One $_FILES entry for $bytes. */
    private function upload(string $bytes, string $name = 'photo.png', int $error = UPLOAD_ERR_OK): array
    {
        $path = $this->uploadDir.'/up-'.bin2hex(random_bytes(6));
        file_put_contents($path, $bytes);
        return ['name' => $name, 'type' => 'application/octet-stream', 'tmp_name' => $path, 'error' => $error, 'size' => strlen($bytes)];
    }

    private static function png(int $w = 40, int $h = 30): string
    {
        $img = imagecreatetruecolor($w, $h);
        imagefill($img, 0, 0, imagecolorallocate($img, 232, 181, 23));
        ob_start();
        imagepng($img);
        return (string) ob_get_clean();
    }

    private static function jpeg(int $w = 30, int $h = 20): string
    {
        $img = imagecreatetruecolor($w, $h);
        ob_start();
        imagejpeg($img);
        return (string) ob_get_clean();
    }

    private static function webp(int $w = 12, int $h = 8): string
    {
        $img = imagecreatetruecolor($w, $h);
        ob_start();
        imagewebp($img);
        return (string) ob_get_clean();
    }

    private static function gif(): string
    {
        $img = imagecreatetruecolor(8, 8);
        ob_start();
        imagegif($img);
        return (string) ob_get_clean();
    }

    /** GET with $get; POST with $post (a reusable CSRF token added unless given) and $files. */
    private function call(string $controller, string $action, array $get = [], ?array $post = null, array $files = []): array
    {
        $server = ['REQUEST_METHOD' => $post === null ? 'GET' : 'POST'];
        $this->container['request'] = new Request($this->container, $server, $get, $post ?? [], $files, []);
        $resp = $this->getMockBuilder(Response::class)->setConstructorArgs([$this->container])->onlyMethods(['send'])->getMock();
        $this->container['response'] = $resp;
        (new $controller($this->container))->$action();
        $read = fn (string $p) => (new ReflectionProperty(Response::class, $p))->getValue($resp);
        $body = (string) $read('httpBody');
        return ['status' => $read('httpStatusCode'), 'headers' => $read('httpHeaders'), 'body' => $body, 'json' => json_decode($body, true)];
    }

    private function reusable(): string
    {
        return $this->container['token']->getReusableCSRFToken();
    }

    private function formToken(): string
    {
        return $this->container['token']->getCSRFToken();
    }

    private function assertJsonError(array $out, int $status, string $code): void
    {
        $this->assertSame($status, $out['status'], $out['body']);
        $this->assertSame($code, $out['json']['error'] ?? null, $out['body']);
    }
}
