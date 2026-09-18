import { useAuth } from '../app/auth';
import { useUiStore } from '../app/store';
export function useBrandScope() { const { user } = useAuth(); const activeBrandId = useUiStore((state) => state.activeBrandId); const brandId = user?.role === 'superadmin' ? activeBrandId : user?.brandId; return { brandId, query: brandId ? `?brandId=${brandId}` : '' }; }
