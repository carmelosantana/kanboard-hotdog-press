<?php
namespace Kanboard\Plugin\HotDogPress\Controller;

use Kanboard\Core\Controller\AccessForbiddenException;
use Kanboard\Core\Controller\PageNotFoundException;
use Kanboard\Plugin\HotDogPress\Model\ZineRejected;

// One error envelope and one code → HTTP status map for the JSON endpoints: {"error": code, "message": …, …extra}.
trait JsonErrors
{
    private static array $statuses = [
        'bad_request' => 400,
        'forbidden' => 403,
        'not_found' => 404,
        'conflict' => 409,
        'too_large' => 413,
        'unsupported' => 415,
        'invalid' => 422,
        'unavailable' => 503,
    ];

    /** Runs $endpoint, answering any refusal (including core's 404/403 exceptions and CSRF) as JSON. */
    private function json(\Closure $endpoint): void
    {
        try {
            $endpoint();
        } catch (ZineRejected $e) {
            $this->error($e->code, $e->getMessage(), $e->extra);
        } catch (PageNotFoundException) {
            $this->error('not_found', 'No such zine.');
        } catch (AccessForbiddenException) {
            $this->error('forbidden', 'You cannot do that here.');
        }
    }

    private function error(string $code, string $message, array $extra = []): void
    {
        $this->response->json(['error' => $code, 'message' => $message] + $extra, self::$statuses[$code] ?? 400);
    }
}
