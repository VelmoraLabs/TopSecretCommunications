import { apiRequest } from '../../lib/api'
import type { RoleCode } from '../auth/auth'

export interface Profile {
  id: string
  auth_user_id: string | null
  email: string
  display_name: string
  role_code: RoleCode
  is_active: boolean
  created_by: string | null
  created_at: string
  updated_at: string
}
export interface Role {
  code: RoleCode
  name: string
  permissions: string[]
}
export interface ProfilePage {
  items: Profile[]
  total: number
  limit: number
  offset: number
}
export interface ProfileUpdate {
  display_name: string
  role_code: RoleCode
  is_active: boolean
}
export const permissionNames: Record<string, string> = {
  'groups.read': 'Consultar sus grupos',
  'groups.manage': 'Organizar y administrar grupos',
  'profiles.manage': 'Administrar perfiles',
  'documents.create': 'Crear documentos',
  'documents.read_assigned': 'Consultar documentos asignados',
  'documents.sign': 'Firmar la emisión de documentos propios',
  'documents.approve': 'Aprobar institucionalmente como Embajador',
  'recovery.request': 'Solicitar recuperación en su grupo',
  'recovery.contribute': 'Aportar su fragmento',
}
export function getProfiles(
  email: string,
  state: string,
  offset: number,
  signal: AbortSignal,
) {
  const params = new URLSearchParams({
    email,
    limit: '20',
    offset: String(offset),
  })
  if (state !== 'all') params.set('active', String(state === 'active'))
  return apiRequest<ProfilePage>('/api/v1/admin/profiles?' + params, {
    signal,
  })
}
export const getRoles = (signal: AbortSignal) =>
  apiRequest<Role[]>('/api/v1/admin/roles', { signal })
export const createProfile = (body: {
  email: string
  display_name: string
  role_code: RoleCode
}) =>
  apiRequest<{ id: string }>('/api/v1/admin/profiles', {
    method: 'POST',
    body: JSON.stringify(body),
  })
export const updateProfile = (id: string, body: ProfileUpdate) =>
  apiRequest<void>('/api/v1/admin/profiles/' + id, {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
