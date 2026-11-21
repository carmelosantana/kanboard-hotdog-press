<?php
namespace Kanboard\Plugin\HotDogPress\Controller;

use Kanboard\Controller\BaseController;

// Task 1 browser spike (removed at the end of the task): module scripts, canvas taint, Blob download.
class SpikeController extends BaseController
{
    public function show(): void
    {
        $this->response->html($this->helper->layout->app('HotDogPress:spike/show', [
            'title' => 'Hot Dog Press spike',
        ]));
    }
}
