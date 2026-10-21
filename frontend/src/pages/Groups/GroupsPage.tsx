import { useEffect, useState } from 'react'
import {
  Archive,
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  Info,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  UserPlus,
  UsersRound,
  X,
} from 'lucide-react'
import Badge from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import Card from '../../components/ui/Card'
import Modal from '../../components/ui/Modal'
import PageHeader from '../../components/ui/PageHeader'
import TextField from '../../components/ui/TextField'
import { useAuth, roleNames } from '../../features/auth/auth'
import {
  getGroup,
  getGroups,
  groupRoleNames,
  removeMember,
  setMember,
} from '../../features/groups/groups'
import type {
  Group,
  GroupDetail,
  GroupRole,
  Member,
  Page,
} from '../../features/groups/groups'
import {
  AddMember,
  Feedback,
  GroupForm,
  Loading,
  Pagination,
} from '../../features/groups/GroupComponents'
import './groups.css'

const message = (error: unknown) =>
  error instanceof Error ? error.message : 'No se pudo completar la operación.'
const initials = (name: string) =>
  name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase()

export default function GroupsPage() {
  const auth = useAuth()
  const administrator = auth.hasPermission('groups.manage')
  const [page, setPage] = useState<Page<Group> | null>(null)
  const [search, setSearch] = useState('')
  const [state, setState] = useState('active')
  const [offset, setOffset] = useState(0)
  const [selected, setSelected] = useState<string | null>(null)
  const [detail, setDetail] = useState<GroupDetail | null>(null)
  const [revision, setRevision] = useState(0)
  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [error, setError] = useState('')
  const [detailError, setDetailError] = useState('')
  const [actionError, setActionError] = useState('')
  const [notice, setNotice] = useState('')
  const [form, setForm] = useState<'create' | 'edit' | null>(null)
  const [adding, setAdding] = useState(false)
  const [removing, setRemoving] = useState<Member | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setLoading(true)
      setError('')
      void getGroups(search.trim(), state, offset, controller.signal)
        .then((value) => {
          if (!controller.signal.aborted) setPage(value)
        })
        .catch((error) => {
          if (!controller.signal.aborted) {
            setError(message(error))
            setPage(null)
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false)
        })
    }, 200)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [search, state, offset, revision])

  useEffect(() => {
    const controller = new AbortController()
    if (!selected) return
    void getGroup(selected, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setDetail(value)
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          setDetail(null)
          setDetailError(message(error))
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setDetailLoading(false)
      })
    return () => controller.abort()
  }, [selected, revision])

  function choose(id: string) {
    if (id === selected) {
      reload()
      return
    }
    setSelected(id)
    setDetail(null)
    setDetailError('')
    setActionError('')
    setDetailLoading(true)
  }
  function reload() {
    setDetailError('')
    setDetailLoading(Boolean(selected))
    setRevision((value) => value + 1)
  }
  function saved(id: string) {
    setActionError('')
    setDetailError('')
    setForm(null)
    setAdding(false)
    setOffset(0)
    setSelected(id)
    setDetailLoading(true)
    setNotice('Los cambios del grupo se guardaron correctamente.')
    reloadAfterSave()
  }
  function reloadAfterSave() {
    setLoading(true)
    setRevision((value) => value + 1)
  }
  function lastManager(member: Member) {
    return (
      member.is_active &&
      member.group_role === 'manager' &&
      detail?.members.filter(
        (person) => person.is_active && person.group_role === 'manager',
      ).length === 1
    )
  }
  function removalReason(member: Member) {
    if (detail && detail.members.length <= 2)
      return 'Agrega otro integrante antes de retirar: el grupo necesita al menos dos.'
    return lastManager(member)
      ? 'Designa otro responsable activo antes de cambiar el papel o retirar a esta persona.'
      : ''
  }
  async function changeRole(member: Member, role: GroupRole) {
    if (!detail || busy || (role !== 'manager' && lastManager(member))) return
    setBusy(true)
    setActionError('')
    try {
      await setMember(detail.group, member.id, role)
      setNotice('El papel de la persona dentro del grupo se actualizó.')
    } catch (error) {
      setActionError(message(error))
    } finally {
      setBusy(false)
      reload()
    }
  }
  async function confirmRemove() {
    if (!detail || !removing || busy || removalReason(removing)) return
    setBusy(true)
    setActionError('')
    try {
      await removeMember(detail.group, removing.id)
      setNotice('La persona se retiró del grupo. Su historial se conserva.')
      if (removing.id === auth.access?.profile.id && !administrator) {
        setSelected(null)
        setDetail(null)
      }
    } catch (error) {
      setActionError(message(error))
    } finally {
      setRemoving(null)
      setBusy(false)
      reloadAfterSave()
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="PERSONAS Y COLABORACIÓN"
        title="Grupos de trabajo"
        description="Define quiénes forman parte de cada equipo y quién coordina su participación."
        action={
          administrator && (
            <Button onClick={() => setForm('create')}>
              <Plus size={18} />
              Crear grupo
            </Button>
          )
        }
      />
      <section className="groups-intro">
        <div className="groups-intro-icon">
          <UsersRound size={30} />
        </div>
        <div>
          <p className="eyebrow">UN EQUIPO, UN PROPÓSITO</p>
          <h2>La colaboración empieza aquí.</h2>
          <p>
            Organiza a las personas autorizadas de tu oficina en grupos con
            responsables definidos.
          </p>
        </div>
        <Badge tone="purple">
          <ShieldCheck size={14} />
          {administrator ? 'Administración de grupos' : 'Tus equipos'}
        </Badge>
      </section>
      {notice && (
        <div className="groups-feedback groups-feedback--success" role="status">
          <CheckCircle2 size={18} />
          <span>{notice}</span>
          <button
            className="icon-button"
            aria-label="Cerrar aviso"
            onClick={() => setNotice('')}
          >
            <X size={16} />
          </button>
        </div>
      )}
      <div className="groups-columns">
        <Card className="groups-directory">
          <div className="groups-section-heading">
            <div>
              <p className="eyebrow">ESPACIOS COMPARTIDOS</p>
              <h2>{administrator ? 'Grupos de la oficina' : 'Mis grupos'}</h2>
            </div>
            <Badge tone="neutral">
              {loading
                ? 'Consultando…'
                : `${page?.total ?? 0} ${page?.total === 1 ? 'grupo' : 'grupos'}`}
            </Badge>
          </div>
          <div className="groups-filters">
            <TextField
              label="Buscar grupo"
              hideLabel
              icon={Search}
              placeholder="Buscar grupo"
              maxLength={80}
              value={search}
              onChange={(event) => {
                setSearch(event.target.value)
                setOffset(0)
              }}
            />
            <select
              aria-label="Estado del grupo"
              value={state}
              onChange={(event) => {
                setState(event.target.value)
                setOffset(0)
              }}
            >
              <option value="active">Activos</option>
              <option value="archived">Archivados</option>
              <option value="all">Todos</option>
            </select>
            <Button
              variant="ghost"
              aria-label="Actualizar grupos"
              disabled={loading || busy}
              onClick={reload}
            >
              <RefreshCw size={17} />
            </Button>
          </div>
          {error && <Feedback text={error} />}
          {loading ? (
            <Loading text="Consultando grupos…" />
          ) : (
            !error && (
              <div className="groups-list">
                {page?.items.length === 0 && (
                  <div className="groups-empty">
                    <UsersRound size={36} />
                    <h3>
                      {search || state !== 'active'
                        ? 'No hay resultados'
                        : 'Tu próximo equipo empieza aquí'}
                    </h3>
                    <p>
                      {administrator
                        ? 'Crea un grupo y selecciona sus integrantes.'
                        : 'Cuando te asignen a un grupo, podrás consultarlo en este espacio.'}
                    </p>
                  </div>
                )}
                {page?.items.map((group) => (
                  <button
                    className={`groups-item ${selected === group.id ? 'is-selected' : ''}`}
                    key={group.id}
                    disabled={busy}
                    onClick={() => choose(group.id)}
                    aria-pressed={selected === group.id}
                  >
                    <span className="groups-item-icon">
                      {group.is_active ? (
                        <UsersRound size={20} />
                      ) : (
                        <Archive size={20} />
                      )}
                    </span>
                    <span className="groups-item-copy">
                      <strong>{group.name}</strong>
                      <span>{group.description || 'Sin descripción'}</span>
                      <small>
                        {group.member_count} integrantes ·{' '}
                        {group.my_role
                          ? groupRoleNames[group.my_role]
                          : 'Gestión administrativa'}
                      </small>
                    </span>
                    <ChevronRight size={17} />
                  </button>
                ))}
              </div>
            )
          )}
          <Pagination
            offset={offset}
            total={page?.total ?? 0}
            size={12}
            loading={loading}
            onChange={setOffset}
          />
        </Card>
        <div className="groups-detail-column">
          {!selected ? (
            <Card className="groups-welcome">
              <div>
                <ShieldCheck size={35} />
              </div>
              <p className="eyebrow">PERSONAS CON UN ALCANCE CLARO</p>
              <h2>Conoce a tu equipo.</h2>
              <p>
                Selecciona un grupo para consultar sus integrantes y
                responsables.
              </p>
              <span>
                <ArrowRight size={16} />
                Cada grupo conserva su propia organización.
              </span>
            </Card>
          ) : (
            <Card className="groups-detail" aria-busy={detailLoading}>
              {detailLoading ? (
                <Loading text="Consultando integrantes…" />
              ) : detailError ? (
                <Feedback text={detailError} />
              ) : (
                detail && (
                  <>
                    <div className="groups-section-heading">
                      <div>
                        <p className="eyebrow">DETALLE DEL GRUPO</p>
                        <h2>{detail.group.name}</h2>
                      </div>
                      <Badge
                        tone={detail.group.is_active ? 'green' : 'neutral'}
                      >
                        {detail.group.is_active ? 'Activo' : 'Archivado'}
                      </Badge>
                    </div>
                    <p className="groups-description">
                      {detail.group.description ||
                        'Este grupo todavía no tiene una descripción.'}
                    </p>
                    <div className="groups-detail-toolbar">
                      <span>
                        <UsersRound size={16} />
                        {detail.group.active_member_count} activos de{' '}
                        {detail.group.member_count}
                      </span>
                      <div>
                        {(detail.group.can_manage ||
                          detail.group.can_archive) && (
                          <Button
                            variant="outline"
                            disabled={busy}
                            onClick={() => setForm('edit')}
                          >
                            <Pencil size={15} />
                            Editar
                          </Button>
                        )}
                        {detail.group.can_manage && (
                          <Button
                            disabled={busy}
                            onClick={() => setAdding(true)}
                          >
                            <UserPlus size={16} />
                            Agregar
                          </Button>
                        )}
                      </div>
                    </div>
                    {actionError && <Feedback text={actionError} />}
                    {detail.group.active_member_count !==
                      detail.group.member_count && (
                      <p className="groups-note">
                        <Info size={17} />
                        Hay perfiles desactivados. Su pertenencia se conserva,
                        pero no pueden operar con su cuenta.
                      </p>
                    )}
                    <div className="groups-members">
                      {detail.members.map((member) => (
                        <div className="groups-member" key={member.id}>
                          <span className="groups-avatar">
                            {initials(member.display_name)}
                          </span>
                          <div className="groups-member-copy">
                            <strong>
                              {member.display_name}
                              {member.id === auth.access?.profile.id && (
                                <small className="groups-you">Tú</small>
                              )}
                            </strong>
                            <span>{member.email}</span>
                            <small>
                              {roleNames[member.role_code]} ·{' '}
                              {!member.is_active
                                ? 'Perfil desactivado'
                                : member.is_linked
                                  ? 'Cuenta vinculada'
                                  : 'Pendiente de primer acceso'}
                            </small>
                            {detail.group.can_manage &&
                              (removalReason(member) || !member.is_active) && (
                                <small id={`member-help-${member.id}`}>
                                  {!member.is_active
                                    ? 'Reactiva el perfil desde Administración para cambiar su papel. '
                                    : ''}
                                  {removalReason(member)}
                                </small>
                              )}
                          </div>
                          {detail.group.can_manage ? (
                            <div className="groups-member-actions">
                              <select
                                aria-label={`Papel de ${member.display_name}`}
                                value={member.group_role}
                                disabled={
                                  busy ||
                                  !member.is_active ||
                                  lastManager(member)
                                }
                                aria-describedby={
                                  removalReason(member) || !member.is_active
                                    ? `member-help-${member.id}`
                                    : undefined
                                }
                                onChange={(event) =>
                                  void changeRole(
                                    member,
                                    event.target.value as GroupRole,
                                  )
                                }
                              >
                                <option value="manager">Responsable</option>
                                <option value="member">Integrante</option>
                              </select>
                              <Button
                                variant="ghost"
                                disabled={
                                  busy || Boolean(removalReason(member))
                                }
                                aria-describedby={
                                  removalReason(member) || !member.is_active
                                    ? `member-help-${member.id}`
                                    : undefined
                                }
                                aria-label={`Retirar a ${member.display_name}`}
                                onClick={() => setRemoving(member)}
                              >
                                <Trash2 size={16} />
                              </Button>
                            </div>
                          ) : (
                            <Badge
                              tone={
                                member.group_role === 'manager'
                                  ? 'purple'
                                  : 'neutral'
                              }
                            >
                              {groupRoleNames[member.group_role]}
                            </Badge>
                          )}
                        </div>
                      ))}
                    </div>
                    <p className="groups-note">
                      <ShieldCheck size={17} />
                      El papel dentro de este grupo es independiente del rol
                      general de cada persona.
                    </p>
                  </>
                )
              )}
            </Card>
          )}
          <div className="groups-scope">
            <ShieldCheck size={21} />
            <p>
              <strong>Organización con acceso definido</strong>Administrar un
              grupo no concede acceso automático a sus documentos ni a los
              fragmentos de sus integrantes.
            </p>
          </div>
        </div>
      </div>
      {form && (
        <GroupForm
          key={form === 'create' ? 'create' : detail?.group.id}
          group={form === 'edit' ? (detail?.group ?? null) : null}
          onClose={() => setForm(null)}
          onSaved={saved}
        />
      )}
      {adding && detail && (
        <AddMember
          group={detail.group}
          onClose={() => setAdding(false)}
          onSaved={saved}
        />
      )}
      {removing && (
        <Modal
          open
          busy={busy}
          title="Retirar integrante"
          onClose={() => {
            if (!busy) setRemoving(null)
          }}
        >
          <p>
            ¿Quieres retirar a <strong>{removing.display_name}</strong> de este
            grupo?
          </p>
          <p className="groups-note">
            El grupo debe conservar al menos dos integrantes y un responsable
            activo. Esta operación no modifica documentos anteriores.
          </p>
          <div className="groups-form-actions">
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setRemoving(null)}
            >
              Cancelar
            </Button>
            <Button disabled={busy} onClick={() => void confirmRemove()}>
              {busy ? 'Retirando…' : 'Retirar del grupo'}
            </Button>
          </div>
        </Modal>
      )}
    </>
  )
}
