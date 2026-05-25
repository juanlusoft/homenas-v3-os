import { ContainersCard } from './ContainersCard'
import { ComposeStacksCard } from './ComposeStacksCard'
import { useT } from '../../i18n/useT'

export function DockerView() {
  const t = useT()
  return (
    <div className="space-y-6">
      <div className="mb-2">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{t.docker.title}</h1>
        <p className="text-sm text-gray-500 dark:text-white/40 mt-1">{t.docker.subtitle}</p>
      </div>

      {/* Containers table */}
      <ContainersCard />

      {/* Compose stacks */}
      <ComposeStacksCard />
    </div>
  )
}
