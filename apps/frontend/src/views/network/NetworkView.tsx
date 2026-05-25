import { InterfacesCard } from './InterfacesCard'
import { IpConfigCard } from './IpConfigCard'
import { WireguardCard } from './WireguardCard'
import { SambaCard } from './SambaCard'
import { NfsCard } from './NfsCard'
import { DDNSCard } from './DDNSCard'
import { useT } from '../../i18n/useT'

export function NetworkView() {
  const t = useT()
  return (
    <div className="space-y-6">
      <div className="mb-2">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{t.network.title}</h1>
        <p className="text-sm text-gray-500 dark:text-white/40 mt-1">{t.network.subtitle}</p>
      </div>

      {/* Full-width: Interfaces table */}
      <InterfacesCard />

      {/* Full-width: IP configuration (DHCP / static) */}
      <IpConfigCard />

      {/* Full-width: WireGuard VPN */}
      <WireguardCard />

      {/* Full-width: Dynamic DNS */}
      <DDNSCard />

      {/* Two-column: Samba + NFS */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <SambaCard />
        <NfsCard />
      </div>
    </div>
  )
}
