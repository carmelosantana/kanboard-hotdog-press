<?php
namespace Kanboard\Plugin\HotDogPress\Controller;

use Kanboard\Controller\BaseController;
use Kanboard\Plugin\HotDogPress\Model\ZineModel;

// GET hotdogpress/mine: the zines in every active project the user belongs to, last changed first, paginated.
class MyZinesController extends BaseController
{
    use PluginPage;

    public const PER_PAGE = 30;

    public function index(): void
    {
        $user = $this->getUser();
        $paginator = $this->paginator
            ->setUrl('MyZinesController', 'index', ['plugin' => 'HotDogPress'])
            ->setMax(self::PER_PAGE)
            ->setOrder(ZineModel::TABLE.'.updated_at')
            ->setDirection('DESC')
            ->setQuery((new ZineModel($this->container))->queryForUser((int) $user['id']))
            ->calculate();

        $this->withStylesheet();
        $this->response->html($this->helper->layout->dashboard('HotDogPress:zine/dashboard', [
            'title' => t('My zines'),
            'user' => $user,
            'paginator' => $paginator,
        ]));
    }
}
