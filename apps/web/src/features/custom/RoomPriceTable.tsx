import { customRoomsFor } from '@csumroh/shared-types';
import { cn } from '../../lib/cn';
import { money, type CustomRequest } from './customApi';

/**
 * Rincian harga Tim LA per tipe kamar: jamaah × harga per jamaah (ditawarkan / terendah) dan totalnya.
 * `showFloor` = false menyembunyikan harga terendah (mis. untuk tampilan yang bisa dibaca pihak lain).
 */
export function RoomPriceTable({ request, showFloor = true, className }: {
  request: Pick<CustomRequest, 'paxQuad' | 'paxTriple' | 'paxDouble' | 'paxInfant' | 'offeredPrices' | 'floorPrices' | 'offeredPrice' | 'floorPrice'>;
  showFloor?: boolean; className?: string;
}) {
  const rooms = customRoomsFor(request);
  return <table className={cn('w-full text-xs tabular-nums', className)}>
    <thead>
      <tr className="text-left text-zinc-500">
        <th className="py-1 font-medium">Kamar</th>
        <th className="py-1 text-right font-medium">Ditawarkan / jamaah</th>
        {showFloor && <th className="py-1 text-right font-medium text-zinc-500">Terendah / jamaah</th>}
      </tr>
    </thead>
    <tbody>
      {rooms.map((room) => <tr key={room.key} className="border-t border-zinc-200/70">
        <td className="py-1 text-zinc-700">{room.label} <span className="text-zinc-500">× {room.pax}</span></td>
        <td className="py-1 text-right text-zinc-900">{money(request.offeredPrices?.[room.key])}</td>
        {showFloor && <td className="py-1 text-right text-zinc-500">{money(request.floorPrices?.[room.key])}</td>}
      </tr>)}
      <tr className="border-t border-zinc-300 font-semibold text-zinc-950">
        <td className="py-1">Total</td>
        <td className="py-1 text-right">{money(request.offeredPrice)}</td>
        {showFloor && <td className="py-1 text-right font-normal text-zinc-500">{money(request.floorPrice)}</td>}
      </tr>
    </tbody>
  </table>;
}
