<?php
namespace Kanboard\Plugin\HotDogPress\Model;

// A refused zine request. `code` is a wire string the JSON endpoints map to an HTTP status (JsonErrors):
// bad_request, forbidden, not_found, conflict, too_large, unsupported, invalid or unavailable. `extra` is merged
// into the JSON error body (validation errors, the current revision).
// Exception::$code cannot be redeclared readonly or typed, so it is widened to public and only set here.
class ZineRejected extends \RuntimeException
{
    /** @var string */
    public $code;

    public function __construct(string $code, string $message, public readonly array $extra = [])
    {
        parent::__construct($message);
        $this->code = $code;
    }
}
