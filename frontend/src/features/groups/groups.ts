import { apiRequest } from '../../lib/api'
import type { RoleCode } from '../auth/auth'

export type GroupRole = 'manager' | 'member'
export interface Group {
  id: string
  name: string
  description: string
  is_active: boolean
  version: number
  created_at: string
  updated_at: string
  member_count: number
  active_member_count: number
  my_role: GroupRole | null
  can_manage: boolean
  can_archive: boolean
}
export interface Candidate {
  id: string
  display_name: string
  email: string
  role_code: RoleCode
  is_active: boolean
  is_linked: boolean
}
export interface Member extends Candidate {
  group_role: GroupRole
  joined_at: string
}
export interface GroupDetail {
  group: Group
  members: Member[]
}
export interface Page<T> {
  items: T[]
  total: number
  limit: number
  offset: number
}
export interface GroupInput {
  name: string
  description: string
}
export const groupRoleNames: Record<GroupRole, string> = {
  manager: 'Responsable',
  member: 'Integrante',
}
export function getGroups(
  search: string,
  state: string,
  offset: number,
  signal: AbortSignal,
) {
  const params = new URLSearchParams({
    search,
    state,
    offset: String(offset),
    limit: '12',
  })
  return apiRequest<Page<Group>>('/api/v1/groups?' + params, { signal })
}
export const getGroup = (id: string, signal?: AbortSignal) =>
  apiRequest<GroupDetail>('/api/v1/groups/' + id, { signal })
export function getCandidates(
  groupId: string | null,
  search: string,
  offset: number,
  signal: AbortSignal,
) {
  const params = new URLSearchParams({
    search,
    offset: String(offset),
    limit: '10',
  })
  if (groupId) params.set('group_id', groupId)
  return apiRequest<Page<Candidate>>('/api/v1/groups/candidates?' + params, {
    signal,
  })
}
export const createGroup = (
  body: GroupInput & {
    members: { profile_id: string; group_role: GroupRole }[]
  },
) =>
  apiRequest<{ id: string }>('/api/v1/groups', {
    method: 'POST',
    body: JSON.stringify(body),
  })
export const updateGroup = (
  group: Group,
  body: GroupInput & { is_active: boolean },
) =>
  apiRequest<void>('/api/v1/groups/' + group.id, {
    method: 'PATCH',
    body: JSON.stringify({ ...body, expected_version: group.version }),
  })
export const setMember = (group: Group, profileId: string, role: GroupRole) =>
  apiRequest<void>('/api/v1/groups/' + group.id + '/members', {
    method: 'PUT',
    body: JSON.stringify({
      profile_id: profileId,
      group_role: role,
      expected_version: group.version,
    }),
  })
export const removeMember = (group: Group, profileId: string) =>
  apiRequest<void>(
    `/api/v1/groups/${group.id}/members/${profileId}?expected_version=${group.version}`,
    { method: 'DELETE' },
  )
