<?php
namespace Kanboard\Plugin\HotDogPress\Controller;

use Kanboard\Core\Controller\AccessForbiddenException;
use Kanboard\Core\Controller\PageNotFoundException;
use Kanboard\Plugin\HotDogPress\Model\ZineModel;

/**
 * The one permission check for zine requests, driven by the project access map in Plugin.php. A zine or project
 * the user cannot even view is "not found" exactly like a missing id (no existence leak); a project they can view
 * but whose role is too low for the action is "forbidden".
 */
trait ZineAccess
{
    /** The zine named by :zine_id, if the user may run $action on it. */
    private function zineFor(string $action): array
    {
        $zine = (new ZineModel($this->container))->getById($this->request->getIntegerParam('zine_id'));
        $this->authorize($zine === null ? 0 : (int) $zine['project_id'], $action);
        return $zine;
    }

    /** The project named by :project_id, if the user may run $action in it. */
    private function projectFor(string $action): array
    {
        $project = $this->projectModel->getById($this->request->getIntegerParam('project_id'));
        $this->authorize(empty($project) ? 0 : (int) $project['id'], $action);
        return $project;
    }

    private function can(string $controller, string $action, int $projectId): bool
    {
        return $this->helper->user->hasProjectAccess($controller, $action, $projectId);
    }

    private function authorize(int $projectId, string $action): void
    {
        if ($projectId === 0 || ! $this->can('ZineController', 'index', $projectId)) {
            throw new PageNotFoundException();
        }
        if (! $this->can(substr(strrchr(static::class, '\\'), 1), $action, $projectId)) {
            throw new AccessForbiddenException();
        }
    }
}
