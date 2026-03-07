interface ProjectRepoDeps {
  db: any
}

export class ProjectRepo {
  private readonly db: any

  constructor(deps: ProjectRepoDeps) {
    this.db = deps.db
  }

  touch(projectId: string, at: string): void {
    this.db.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(at, projectId)
  }
}
