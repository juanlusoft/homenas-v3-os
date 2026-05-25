import { DisksCard } from './DisksCard'
import { SnapRaidCard } from './SnapRaidCard'
import { MergerFSCard } from './MergerFSCard'
import { BadblocksCard } from './BadblocksCard'
import { useT } from '../../i18n/useT'

export function StorageView() {
  const t = useT()
  return (
    <div className="space-y-6">
      <div className="mb-2">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{t.storage.title}</h1>
        <p className="text-sm text-gray-500 dark:text-white/40 mt-1">
          {t.storage.subtitle}
        </p>
      </div>

      {/* Full-width: Disks table */}
      <DisksCard />

      {/* Two-column: SnapRAID + MergerFS */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <SnapRaidCard />
        <MergerFSCard />
      </div>

      {/* Full-width: Badblocks */}
      <BadblocksCard />
    </div>
  )
}
