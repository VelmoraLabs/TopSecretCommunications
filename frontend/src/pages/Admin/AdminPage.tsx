import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Info,
  LoaderCircle,
  Pencil,
  RefreshCw,
  Search,
  ShieldCheck,
  UserPlus,
  UsersRound,
} from 'lucide-react'
import { useNavigate } from 'react-router'
import Badge from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import Card from '../../components/ui/Card'
import Modal from '../../components/ui/Modal'
import PageHeader from '../../components/ui/PageHeader'
import TextField from '../../components/ui/TextField'
import { useAuth } from '../../features/auth/auth'
import type { RoleCode } from '../../features/auth/auth'
import {
  createProfile,
  getProfiles,
  getRoles,
  permissionNames,
  updateProfile,
} from '../../features/admin/profiles'
import type {
  Profile,
  ProfilePage,
  ProfileUpdate,
  Role,
} from '../../features/admin/profiles'
import './admin.css'

const message = (error: unknown) =>
  error instanceof Error ? error.message : 'No se pudo completar la operación.'

export default function AdminPage() {
  const auth = useAuth()
  const navigate = useNavigate()
  const [roles, setRoles] = useState<Role[]>([])
  const [page, setPage] = useState<ProfilePage | null>(null)
  const [search, setSearch] = useState('')
  const [state, setState] = useState('all')
  const [offset, setOffset] = useState(0)
  const [revision, setRevision] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<RoleCode>('staff')
  const [editing, setEditing] = useState<Profile | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setLoading(true)
      setError('')
      void Promise.all([
        getProfiles(search.trim(), state, offset, controller.signal),
        getRoles(controller.signal),
      ])
        .then(([profiles, catalog]) => {
          if (!controller.signal.aborted) {
            setPage(profiles)
            setRoles(catalog)
          }
        })
        .catch((error) => {
          if (!controller.signal.aborted) setError(message(error))
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false)
        })
    }, 250)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [search, state, offset, revision])

  async function authorize(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setCreating(true)
    setCreateError('')
    setNotice('')
    try {
      await createProfile({
        display_name: name.trim(),
        email: email.trim().toLowerCase(),
        role_code: role,
      })
      setName('')
      setEmail('')
      setRole('staff')
      setOffset(0)
      setRevision((value) => value + 1)
      setNotice(
        'Perfil autorizado. La persona ya puede iniciar sesión con su cuenta de Google.',
      )
    } catch (error) {
      setCreateError(message(error))
    } finally {
      setCreating(false)
    }
  }
  async function saved(id: string, update: ProfileUpdate) {
    setEditing(null)
    setNotice('Los cambios del perfil se guardaron correctamente.')
    if (id === auth.access?.profile.id) {
      await auth.refreshAccess()
      if (update.role_code !== 'admin' || !update.is_active) {
        navigate('/dashboard', { replace: true })
        return
      }
    }
    setRevision((value) => value + 1)
  }

  return (
    <>
      <PageHeader
        eyebrow="ADMINISTRACIÓN"
        title="Perfiles y permisos"
        description="Autoriza a las personas de tu oficina y define el alcance de su acceso."
        action={
          <Badge tone="purple">
            <ShieldCheck size={14} /> Gestión de acceso
          </Badge>
        }
      />
      <section className="admin-intro">
        <span>
          <UsersRound size={28} />
        </span>
        <div>
          <p className="eyebrow">CADA CUENTA, UN PROPÓSITO</p>
          <h2>El acceso empieza con las personas.</h2>
          <p>
            Da de alta su correo de Google. Su identidad se vinculará al perfil
            cuando ingrese por primera vez.
          </p>
        </div>
      </section>
      {notice && (
        <div className="admin-feedback admin-feedback--success" role="status">
          <CheckCircle2 size={20} />
          <span>{notice}</span>
        </div>
      )}
      <div className="admin-columns">
        <div className="admin-main">
          <Card className="admin-profiles">
            <div className="admin-section-heading">
              <div>
                <p className="eyebrow">DIRECTORIO DE ACCESO</p>
                <h2>Perfiles de la oficina</h2>
              </div>
              <Badge tone="neutral">
                {loading
                  ? 'Consultando…'
                  : page
                    ? `${page.total} perfiles`
                    : 'Sin consultar'}
              </Badge>
            </div>
            <div className="admin-filters">
              <TextField
                label="Buscar por correo"
                hideLabel
                placeholder="Buscar por correo"
                icon={Search}
                value={search}
                maxLength={80}
                onChange={(event) => {
                  setSearch(event.target.value)
                  setOffset(0)
                }}
              />
              <label className="admin-state-filter">
                <span className="sr-only">Estado del perfil</span>
                <select
                  value={state}
                  onChange={(event) => {
                    setState(event.target.value)
                    setOffset(0)
                  }}
                >
                  <option value="all">Todos los estados</option>
                  <option value="active">Activos</option>
                  <option value="inactive">Desactivados</option>
                </select>
              </label>
              <Button
                variant="ghost"
                aria-label="Actualizar perfiles"
                disabled={loading}
                onClick={() => setRevision((value) => value + 1)}
              >
                <RefreshCw size={17} />
              </Button>
            </div>
            {error ? (
              <div className="admin-feedback" role="alert">
                <Info size={19} />
                <span>{error}</span>
              </div>
            ) : (
              <div className="admin-directory" aria-busy={loading}>
                {loading && (
                  <p className="admin-loading" role="status">
                    <LoaderCircle size={18} className="access-spinner" />
                    Consultando perfiles…
                  </p>
                )}
                {!loading && page?.items.length === 0 && (
                  <div className="admin-empty">
                    <UsersRound size={30} />
                    <h3>No hay perfiles que mostrar</h3>
                    <p>Prueba otro correo o autoriza una nueva cuenta.</p>
                  </div>
                )}
                {!loading && page && page.items.length > 0 && (
                  <div className="admin-table-wrap">
                    <table className="admin-table">
                      <thead>
                        <tr>
                          <th>Persona</th>
                          <th>Rol</th>
                          <th>Estado</th>
                          <th>
                            <span className="sr-only">Acciones</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {page.items.map((profile) => (
                          <tr key={profile.id}>
                            <td>
                              <strong>
                                {profile.display_name}
                                {profile.id === auth.access?.profile.id && (
                                  <small className="admin-you">Tú</small>
                                )}
                              </strong>
                              <span>{profile.email}</span>
                              <small>
                                {profile.auth_user_id
                                  ? 'Cuenta vinculada'
                                  : 'Pendiente de primer acceso'}
                              </small>
                            </td>
                            <td>
                              {roles.find(
                                (role) => role.code === profile.role_code,
                              )?.name ?? profile.role_code}
                            </td>
                            <td>
                              <Badge
                                tone={profile.is_active ? 'green' : 'neutral'}
                              >
                                {profile.is_active ? 'Activo' : 'Desactivado'}
                              </Badge>
                            </td>
                            <td>
                              <Button
                                variant="ghost"
                                aria-label={
                                  'Editar perfil de ' + profile.display_name
                                }
                                onClick={() => setEditing(profile)}
                              >
                                <Pencil size={16} />
                                <span>Editar</span>
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
            <div className="admin-pagination">
              <span>
                {page && page.total > 0
                  ? `${Math.min(offset + 1, page.total)}–${Math.min(offset + 20, page.total)} de ${page.total}`
                  : 'Sin resultados'}
              </span>
              <div>
                <Button
                  variant="outline"
                  disabled={loading || offset === 0}
                  aria-label="Página anterior"
                  onClick={() => setOffset((value) => Math.max(0, value - 20))}
                >
                  <ChevronLeft size={16} />
                </Button>
                <Button
                  variant="outline"
                  disabled={loading || !page || offset + 20 >= page.total}
                  aria-label="Página siguiente"
                  onClick={() => setOffset((value) => value + 20)}
                >
                  <ChevronRight size={16} />
                </Button>
              </div>
            </div>
          </Card>
          <Card className="admin-role-card">
            <div className="admin-section-heading">
              <div>
                <p className="eyebrow">PERMISOS POR ROL</p>
                <h2>Un alcance definido</h2>
              </div>
              <ShieldCheck size={23} />
            </div>
            <div className="admin-role-grid">
              {roles.map((role) => (
                <div key={role.code}>
                  <h3>{role.name}</h3>
                  <ul>
                    {role.permissions.map((permission) => (
                      <li key={permission}>
                        <CheckCircle2 size={14} />
                        {permissionNames[permission] ?? permission}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
            <p className="admin-scope-note">
              <Info size={16} />
              Los documentos requieren asignación y las notas especiales,
              pertenencia al grupo. El rol de administrador no concede acceso
              automático a sus fragmentos.
            </p>
          </Card>
        </div>
        <aside className="admin-aside">
          <Card className="admin-create">
            <span className="admin-create-icon">
              <UserPlus size={25} />
            </span>
            <p className="eyebrow">NUEVA PERSONA</p>
            <h2>Autorizar un perfil</h2>
            <p>
              Su correo será la identidad con la que podrá acceder a la
              plataforma.
            </p>
            <form onSubmit={authorize}>
              <TextField
                label="Nombre completo"
                autoComplete="off"
                required
                maxLength={120}
                value={name}
                disabled={creating}
                onChange={(event) => setName(event.target.value)}
                placeholder="Nombre de la persona"
              />
              <TextField
                label="Correo de Google"
                type="email"
                autoComplete="off"
                required
                maxLength={254}
                value={email}
                disabled={creating}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="nombre@gmail.com"
              />
              <RoleSelect
                value={role}
                onChange={setRole}
                roles={roles}
                disabled={creating || !roles.length}
              />
              {createError && (
                <div className="admin-feedback" role="alert">
                  <Info size={17} />
                  <span>{createError}</span>
                </div>
              )}
              <Button type="submit" disabled={creating || !roles.length}>
                {creating ? (
                  <LoaderCircle className="access-spinner" size={17} />
                ) : (
                  <UserPlus size={17} />
                )}
                {creating ? 'Autorizando…' : 'Autorizar perfil'}
              </Button>
            </form>
          </Card>
          <div className="admin-aside-note">
            <LockNote />
          </div>
        </aside>
      </div>
      {editing && (
        <ProfileEditor
          key={editing.id}
          profile={editing}
          roles={roles}
          onClose={() => setEditing(null)}
          onSaved={saved}
        />
      )}
    </>
  )
}

function RoleSelect({
  value,
  onChange,
  roles,
  disabled,
}: {
  value: RoleCode
  onChange: (role: RoleCode) => void
  roles: Role[]
  disabled: boolean
}) {
  return (
    <label className="field">
      <span className="field-label">Rol de acceso</span>
      <select
        className="admin-select"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value as RoleCode)}
        required
      >
        {!roles.length && <option value="staff">Cargando roles…</option>}
        {roles.map((role) => (
          <option key={role.code} value={role.code}>
            {role.name}
          </option>
        ))}
      </select>
    </label>
  )
}
function LockNote() {
  return (
    <>
      <ShieldCheck size={20} />
      <p>
        <strong>Control en cada operación</strong>Los permisos se comprueban al
        utilizar la plataforma. Puedes desactivar un perfil conservando su
        historial.
      </p>
    </>
  )
}
function ProfileEditor({
  profile,
  roles,
  onClose,
  onSaved,
}: {
  profile: Profile
  roles: Role[]
  onClose: () => void
  onSaved: (id: string, update: ProfileUpdate) => Promise<void>
}) {
  const [name, setName] = useState(profile.display_name)
  const [role, setRole] = useState(profile.role_code)
  const [active, setActive] = useState(profile.is_active)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError('')
    const update = {
      display_name: name.trim(),
      role_code: role,
      is_active: active,
    }
    try {
      await updateProfile(profile.id, update)
      await onSaved(profile.id, update)
    } catch (error) {
      setError(message(error))
      setBusy(false)
    }
  }
  return (
    <Modal
      open
      onClose={() => {
        if (!busy) onClose()
      }}
      title="Editar perfil"
    >
      <form className="admin-edit-form" onSubmit={save}>
        <p className="admin-edit-email">{profile.email}</p>
        <TextField
          label="Nombre completo"
          value={name}
          maxLength={120}
          required
          disabled={busy}
          onChange={(event) => setName(event.target.value)}
        />
        <RoleSelect
          value={role}
          onChange={setRole}
          roles={roles}
          disabled={busy}
        />
        <label className="admin-active-choice">
          <input
            type="checkbox"
            checked={active}
            disabled={busy}
            onChange={(event) => setActive(event.target.checked)}
          />
          <span>
            <strong>Perfil activo</strong>
            <small>Puede acceder con los permisos de su rol.</small>
          </span>
        </label>
        {!active && (
          <p className="admin-edit-warning">
            Al guardar, esta persona perderá el acceso a las operaciones
            protegidas. Su perfil e historial se conservarán.
          </p>
        )}
        {error && (
          <div className="admin-feedback" role="alert">
            <Info size={18} />
            <span>{error}</span>
          </div>
        )}
        <div className="admin-edit-actions">
          <Button variant="outline" disabled={busy} onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" disabled={busy}>
            {busy && <LoaderCircle size={17} className="access-spinner" />}
            {busy ? 'Guardando…' : 'Guardar cambios'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
