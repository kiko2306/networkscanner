const treeBuilder = document.getElementById("tree-builder")
const builderTab = document.getElementById("builder-tab")
const globalTab = document.getElementById("global-tab")
const viewTitle = document.getElementById("view-title")
const viewDescription = document.getElementById("view-description")
const refreshMapsButton = document.getElementById("refresh-maps")
const savedMapsSelect = document.getElementById("saved-maps")
const loadSelectedMapButton = document.getElementById("load-selected-map")
const deleteSelectedMapButton = document.getElementById("delete-selected-map")
const addSwitchButton = document.getElementById("add-switch")
const saveJsonButton = document.getElementById("save-json")
const statusEl = document.getElementById("status")
const detailsEl = document.getElementById("details-content")
const authMenu = document.getElementById("auth-menu")
const authSetupBox = document.getElementById("auth-setup-box")
const createUserModal = document.getElementById("create-user-modal")
const closeCreateUserModalButton = document.getElementById("close-create-user-modal")
const signInModal = document.getElementById("sign-in-modal")
const closeSignInModalButton = document.getElementById("close-sign-in-modal")
const authSetupActionButton = document.getElementById("auth-setup-action")
const authLoginActionButton = document.getElementById("auth-login-action")
const authCreateActionButton = document.getElementById("auth-create-action")
const setupUsernameInput = document.getElementById("setup-username")
const setupPasswordInput = document.getElementById("setup-password")
const setupAdminButton = document.getElementById("setup-admin")
const loginUsernameInput = document.getElementById("login-username")
const loginPasswordInput = document.getElementById("login-password")
const loginButton = document.getElementById("login-button")
const logoutButton = document.getElementById("logout-button")
const authUserLabel = document.getElementById("auth-user-label")
const newUserUsernameInput = document.getElementById("new-user-username")
const newUserPasswordInput = document.getElementById("new-user-password")
const createUserButton = document.getElementById("create-user-button")

const DEFAULT_SAVE_NAME = "NetworkHierarchy.updated.json"
const API_BASE_URL = "http://localhost:9008/api"

const ICON_CHOICES = [
    { key: "auto", label: "Auto detect", icon: "?" },
    { key: "gateway", label: "Gateway", icon: "🌐" },
    { key: "router", label: "Router", icon: "📶" },
    { key: "switch", label: "Dumb Switch", icon: "🔀" },
    { key: "switch-poe", label: "Dumb Switch POE", icon: "⚡" },
    { key: "ap", label: "Access Point", icon: "📡" },
    { key: "server", label: "Server", icon: "🖥" },
    { key: "nas", label: "NAS", icon: "🗄" },
    { key: "laptop", label: "Laptop", icon: "💼" },
    { key: "mobile", label: "Mobile Phone", icon: "📱" },
    { key: "workstation", label: "Workstation", icon: "💻" },
    { key: "printer", label: "Printer", icon: "🖨" },
    { key: "camera", label: "Camera", icon: "📷" },
    { key: "iot", label: "IoT Device", icon: "🔌" },
    { key: "unknown", label: "Unknown", icon: "❔" }
]

let currentData = null
let selectedNodeId = null
let draggedNodeId = null
let nodeIdCounter = 1
let lastLoadedName = DEFAULT_SAVE_NAME
let currentMapId = null
let currentViewMode = "builder"
let currentGlobalViewMode = "tree"
let cachedMaps = []
const AUTH_STORAGE_KEY = "networkMapApiKey"
const AUTH_USER_STORAGE_KEY = "networkMapUser"
let currentApiKey = localStorage.getItem(AUTH_STORAGE_KEY) || ""
let currentUser = loadStoredUser()
let currentAuthAction = "login"
let currentAuthNeedsSetup = false

const GLOBAL_VIEW_MODES = [
    { key: "tree", label: "Tree Topology", description: "Full hierarchy tree with parent-child branches." },
    { key: "list", label: "Hierarchy List", description: "Full map as an indented list with parent path and no connector lines." },
    { key: "full", label: "Full Topology", description: "All nodes, full metadata, and connectors." },
    { key: "simple", label: "Simple Topology", description: "All nodes with reduced text for quick reading." },
    { key: "infra", label: "Infrastructure Only", description: "Gateway, switches, routers, and APs only." },
    { key: "endpoints", label: "Endpoints Focus", description: "Endpoint devices with just enough path context." },
    { key: "summary", label: "Type Summary", description: "Counts by device type category, no topology map." }
]

builderTab.addEventListener("click", () => setViewMode("builder"))
globalTab.addEventListener("click", () => setViewMode("global"))
authSetupActionButton.addEventListener("click", () => setAuthAction("setup"))
authLoginActionButton.addEventListener("click", () => setAuthAction("login"))
authCreateActionButton.addEventListener("click", () => setAuthAction("create"))
closeCreateUserModalButton.addEventListener("click", closeCreateUserModal)
createUserModal.addEventListener("click", (event) => {
    if (event.target === createUserModal) {
        closeCreateUserModal()
    }
})
closeSignInModalButton.addEventListener("click", closeSignInModal)
signInModal.addEventListener("click", (event) => {
    if (event.target === signInModal) {
        closeSignInModal()
    }
})
document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
        closeCreateUserModal()
        closeSignInModal()
    }
})
refreshMapsButton.addEventListener("click", refreshSavedMaps)
loadSelectedMapButton.addEventListener("click", loadSelectedMapFromApi)
deleteSelectedMapButton.addEventListener("click", deleteSelectedMapFromApi)
savedMapsSelect.addEventListener("change", () => {
    const hasSelection = Boolean(savedMapsSelect.value)
    loadSelectedMapButton.disabled = !hasSelection
    deleteSelectedMapButton.disabled = !hasSelection
})
setupAdminButton.addEventListener("click", setupAdmin)
loginButton.addEventListener("click", login)
logoutButton.addEventListener("click", logout)
createUserButton.addEventListener("click", createUser)

addSwitchButton.addEventListener("click", () => {
    if (!currentData) {
        setStatus("Load data before adding switches.", true)
        return
    }

    const parent = getInsertionParentForNewSwitch()
    const switchIndex = countNodesByType(currentData, "Dumb-Switch") + 1
    const newSwitch = createDumbSwitch(`Dumb Switch ${switchIndex}`)
    newSwitch.__id = generateNodeId()
    newSwitch.__parentId = parent.__id
    parent.Children.push(newSwitch)
    selectedNodeId = newSwitch.__id
    setStatus(`Added ${newSwitch.Name}. Drag devices onto it to connect them.`)
    renderWorkspace()
})

saveJsonButton.addEventListener("click", saveCurrentJson)

async function apiRequest(path, options = {}) {
    const { skipAuth = false, headers: customHeaders = {}, ...fetchOptions } = options
    const headers = {
        "Accept": "application/json",
        ...(fetchOptions.body ? { "Content-Type": "application/json" } : {}),
        ...customHeaders
    }

    if (!skipAuth && currentApiKey) {
        headers["x-api-key"] = currentApiKey
    }

    const response = await fetch(`${API_BASE_URL}${path}`, {
        headers,
        ...fetchOptions
    })

    if (!response.ok) {
        const text = await response.text()
        const error = new Error(`API ${response.status}: ${text}`)
        error.status = response.status
        throw error
    }

    return response.json()
}

function setAuthenticatedState(user, apiKey) {
    currentUser = user || null
    currentApiKey = apiKey || ""
    if (currentApiKey) {
        localStorage.setItem(AUTH_STORAGE_KEY, currentApiKey)
        localStorage.setItem(AUTH_USER_STORAGE_KEY, JSON.stringify(currentUser))
    } else {
        localStorage.removeItem(AUTH_STORAGE_KEY)
        localStorage.removeItem(AUTH_USER_STORAGE_KEY)
    }
}

function loadStoredUser() {
    try {
        const raw = localStorage.getItem(AUTH_USER_STORAGE_KEY)
        return raw ? JSON.parse(raw) : null
    } catch {
        localStorage.removeItem(AUTH_USER_STORAGE_KEY)
        return null
    }
}

function setAuthAction(action) {
    if (action === "login") {
        closeCreateUserModal()
        currentAuthAction = "login"
        renderAuthUi(currentAuthNeedsSetup)
        openSignInModal()
        return
    }

    if (action === "create") {
        closeSignInModal()
        openCreateUserModal()
        return
    }

    closeSignInModal()
    closeCreateUserModal()
    currentAuthAction = action
    renderAuthUi(currentAuthNeedsSetup)
}

function openSignInModal() {
    const isAuthed = Boolean(currentUser && currentApiKey)
    if (isAuthed || currentAuthNeedsSetup) {
        return
    }

    signInModal.hidden = false
}

function closeSignInModal() {
    signInModal.hidden = true
}

function openCreateUserModal() {
    const isAuthed = Boolean(currentUser && currentApiKey)
    if (!isAuthed) {
        return
    }

    createUserModal.hidden = false
}

function closeCreateUserModal() {
    createUserModal.hidden = true
}

function setActiveAuthButton(buttonId) {
    for (const button of [authSetupActionButton, authLoginActionButton, authCreateActionButton]) {
        if (!button) {
            continue
        }
        button.classList.toggle("active", button.id === buttonId)
    }
}

function updateAuthActionAvailability(needsSetup, isAuthed) {
    authSetupActionButton.hidden = !needsSetup
    authLoginActionButton.hidden = needsSetup || isAuthed
    authCreateActionButton.hidden = !isAuthed
    logoutButton.hidden = !isAuthed
    authUserLabel.hidden = !isAuthed
}

function setMapControlsEnabled(enabled) {
    refreshMapsButton.disabled = !enabled
    savedMapsSelect.disabled = !enabled
    loadSelectedMapButton.disabled = !enabled || !savedMapsSelect.value
    deleteSelectedMapButton.disabled = !enabled || !savedMapsSelect.value
    addSwitchButton.disabled = !enabled || !currentData || currentViewMode !== "builder"
    saveJsonButton.disabled = !enabled
}

function renderAuthUi(needsSetup) {
    currentAuthNeedsSetup = needsSetup
    const isAuthed = Boolean(currentUser && currentApiKey)
    updateAuthActionAvailability(needsSetup, isAuthed)

    if (needsSetup) {
        currentAuthAction = "setup"
        closeSignInModal()
    } else if (isAuthed) {
        if (currentAuthAction === "setup") {
            currentAuthAction = "login"
        }
        closeSignInModal()
    } else {
        if (currentAuthAction !== "login") {
            currentAuthAction = "login"
        }
        closeCreateUserModal()
        openSignInModal()
    }

    authSetupBox.hidden = !(needsSetup && currentAuthAction === "setup")

    if (isAuthed) {
        authUserLabel.textContent = currentUser.username
    } else {
        authUserLabel.textContent = ""
    }

    setActiveAuthButton(
        currentAuthAction === "setup" ? authSetupActionButton.id :
            currentAuthAction === "login" ? authLoginActionButton.id :
                authCreateActionButton.id
    )

    setMapControlsEnabled(isAuthed)
}

async function syncAuthState() {
    const status = await apiRequest("/auth/status", { skipAuth: true })
    if (status.needsSetup) {
        setAuthenticatedState(null, "")
        renderAuthUi(true)
        setStatus("First access: create the admin user.")
        return
    }

    if (!currentApiKey) {
        setAuthenticatedState(null, "")
        renderAuthUi(false)
        setStatus("Please login to access maps.")
        return
    }

    try {
        const me = await apiRequest("/auth/me")
        setAuthenticatedState(me.user, currentApiKey)
        renderAuthUi(false)
        setStatus(`Authenticated as ${me.user.username}.`)
        await refreshSavedMaps()
    } catch {
        setAuthenticatedState(null, "")
        renderAuthUi(false)
        setStatus("Stored API key is not valid. Please login again.", true)
    }
}

async function setupAdmin() {
    const username = setupUsernameInput.value.trim()
    const password = setupPasswordInput.value
    if (!username || !password) {
        setStatus("Provide admin username and password.", true)
        return
    }

    setStatus("Creating admin user...")
    try {
        const payload = await apiRequest("/auth/setup-admin", {
            method: "POST",
            skipAuth: true,
            body: JSON.stringify({ username, password })
        })

        setAuthenticatedState(payload.user, payload.apiKey)
        setupPasswordInput.value = ""
        renderAuthUi(false)
        await refreshSavedMaps()
        setStatus(`Admin user ${payload.user.username} created and logged in.`)
    } catch (error) {
        setStatus("Could not create admin user.", true)
        console.error(error)
    }
}

async function login() {
    const username = loginUsernameInput.value.trim()
    const password = loginPasswordInput.value
    if (!username || !password) {
        setStatus("Provide username and password.", true)
        return
    }

    setStatus("Signing in...")
    try {
        const payload = await apiRequest("/auth/login", {
            method: "POST",
            skipAuth: true,
            body: JSON.stringify({ username, password })
        })

        setAuthenticatedState(payload.user, payload.apiKey)
        loginPasswordInput.value = ""
        closeSignInModal()
        renderAuthUi(false)
        await refreshSavedMaps()
        setStatus(`Signed in as ${payload.user.username}.`)
    } catch (error) {
        setStatus("Login failed. Check username/password.", true)
        console.error(error)
    }
}

async function logout() {
    try {
        if (currentApiKey) {
            await apiRequest("/auth/logout", { method: "POST" })
        }
    } catch (error) {
        console.error(error)
    }

    setAuthenticatedState(null, "")
    currentData = null
    currentMapId = null
    selectedNodeId = null
    renderWorkspace()
    renderAuthUi(false)
    setStatus("Logged out.")
}

async function createUser() {
    const username = newUserUsernameInput.value.trim()
    const password = newUserPasswordInput.value
    if (!username || !password) {
        setStatus("Provide new username and password.", true)
        return
    }

    setStatus("Creating user...")
    try {
        const payload = await apiRequest("/users", {
            method: "POST",
            body: JSON.stringify({ username, password })
        })
        newUserUsernameInput.value = ""
        newUserPasswordInput.value = ""
        closeCreateUserModal()
        setStatus(`Created user ${payload.user.username}.`)
    } catch (error) {
        setStatus("Could not create user.", true)
        console.error(error)
    }
}

async function refreshSavedMaps() {
    setStatus("Refreshing saved maps...")
    try {
        const payload = await apiRequest("/maps")
        cachedMaps = Array.isArray(payload.maps) ? payload.maps : []

        savedMapsSelect.innerHTML = ""
        const placeholder = document.createElement("option")
        placeholder.value = ""
        placeholder.textContent = cachedMaps.length > 0 ? "Select a saved map" : "No saved maps found"
        savedMapsSelect.appendChild(placeholder)

        for (const map of cachedMaps) {
            const option = document.createElement("option")
            option.value = String(map.id)
            option.textContent = `${map.name} (${formatMapDate(map.createdAt)})`
            savedMapsSelect.appendChild(option)
        }

        loadSelectedMapButton.disabled = true
        deleteSelectedMapButton.disabled = true
        setStatus(`Loaded ${cachedMaps.length} saved map entries.`)
    } catch (error) {
        setStatus("Could not fetch saved maps from API. Ensure API is running on localhost:9008.", true)
        console.error(error)
    }
}

async function deleteSelectedMapFromApi() {
    const mapId = savedMapsSelect.value
    if (!mapId) {
        setStatus("Select a saved map first.", true)
        return
    }

    const selectedMap = cachedMaps.find((entry) => String(entry.id) === String(mapId))
    const mapName = selectedMap?.name || `#${mapId}`
    const confirmed = window.confirm(`Delete saved map ${mapName}? This cannot be undone.`)
    if (!confirmed) {
        return
    }

    setStatus(`Deleting saved map ${mapName}...`)
    try {
        await apiRequest(`/maps/${mapId}`, { method: "DELETE" })

        if (currentData && selectedMap && String(lastLoadedName) === `${selectedMap.name || "NetworkMap"}.json`) {
            currentData = null
            selectedNodeId = null
            currentMapId = null
            renderWorkspace()
        }

        await refreshSavedMaps()
        setStatus(`Deleted map: ${mapName}.`)
    } catch (error) {
        setStatus(`Could not delete map ${mapName}.`, true)
        console.error(error)
    }
}

async function loadSelectedMapFromApi() {
    const mapId = savedMapsSelect.value
    if (!mapId) {
        setStatus("Select a saved map first.", true)
        return
    }

    setStatus(`Loading saved map #${mapId}...`)
    try {
        const payload = await apiRequest(`/maps/${mapId}`)
        setCurrentData(payload.map)
        currentMapId = Number(payload.id)
        lastLoadedName = `${payload.name || "NetworkMap"}.json`
        setStatus(`Loaded map: ${payload.name || `#${mapId}`}.`)
    } catch (error) {
        setStatus(`Could not load map #${mapId} from API.`, true)
        console.error(error)
    }
}

function setStatus(message, isError = false) {
    statusEl.textContent = message
    statusEl.classList.toggle("error", isError)
}

function formatMapDate(value) {
    if (!value) {
        return "unknown-date"
    }

    const parsed = new Date(value)
    if (Number.isNaN(parsed.getTime())) {
        return "unknown-date"
    }

    const day = String(parsed.getDate()).padStart(2, "0")
    const month = String(parsed.getMonth() + 1).padStart(2, "0")
    const year = String(parsed.getFullYear())
    return `${day}-${month}-${year}`
}

function setCurrentData(root) {
    if (!root || typeof root !== "object") {
        throw new Error("Invalid network data format.")
    }

    nodeIdCounter = 1
    currentData = decorateTree(root, null)
    selectedNodeId = currentData.__id
    saveJsonButton.disabled = false
    addSwitchButton.disabled = false
    renderWorkspace()
}

function setViewMode(mode) {
    currentViewMode = mode
    builderTab.classList.toggle("active", mode === "builder")
    globalTab.classList.toggle("active", mode === "global")
    viewTitle.textContent = mode === "builder" ? "Topology Builder" : "Global Wired View"
    viewDescription.textContent =
        mode === "builder"
            ? "Build your dumb switch layout manually, including cascaded switches."
            : "Read-only overview of the scanned network and your manual wiring layout."

    addSwitchButton.disabled = !currentData || mode !== "builder"
    renderWorkspace()
}

function decorateTree(node, parentId) {
    node.__id = generateNodeId()
    node.__parentId = parentId
    node.Children = Array.isArray(node.Children) ? node.Children : []
    for (const child of node.Children) {
        decorateTree(child, node.__id)
    }
    return node
}

function generateNodeId() {
    const id = `node-${nodeIdCounter}`
    nodeIdCounter += 1
    return id
}

function createDumbSwitch(name) {
    return {
        Name: name,
        Type: "Dumb-Switch",
        RoleGuess: "Switch",
        DeviceIconKey: "switch",
        DeviceIcon: "🔀",
        AdminUser: "",
        AdminPassword: "",
        Children: []
    }
}

function getSelectedNode() {
    return findNodeById(currentData, selectedNodeId) || currentData
}

function findNodeById(node, nodeId) {
    if (!node || !nodeId) {
        return null
    }

    if (node.__id === nodeId) {
        return node
    }

    for (const child of node.Children || []) {
        const found = findNodeById(child, nodeId)
        if (found) {
            return found
        }
    }

    return null
}

function findParentById(node, childId) {
    if (!node || !Array.isArray(node.Children)) {
        return null
    }

    for (const child of node.Children) {
        if (child.__id === childId) {
            return node
        }

        const found = findParentById(child, childId)
        if (found) {
            return found
        }
    }

    return null
}

function isDescendant(node, targetId) {
    if (!node || !Array.isArray(node.Children)) {
        return false
    }

    for (const child of node.Children) {
        if (child.__id === targetId || isDescendant(child, targetId)) {
            return true
        }
    }

    return false
}

function canAcceptChildren(node) {
    return node && (node.Type === "Gateway" || node.Type === "Dumb-Switch")
}

function getInsertionParentForNewSwitch() {
    const selected = getSelectedNode()
    if (selected && canAcceptChildren(selected)) {
        return selected
    }

    if (selected) {
        const parent = findParentById(currentData, selected.__id)
        if (parent && canAcceptChildren(parent)) {
            return parent
        }
    }

    return currentData
}

function moveNode(nodeId, newParentId) {
    const movingNode = findNodeById(currentData, nodeId)
    const oldParent = findParentById(currentData, nodeId)
    const newParent = findNodeById(currentData, newParentId)

    if (!movingNode || !newParent || !canAcceptChildren(newParent)) {
        return false
    }

    if (movingNode.__id === newParent.__id || isDescendant(movingNode, newParent.__id)) {
        return false
    }

    if (oldParent) {
        oldParent.Children = oldParent.Children.filter((child) => child.__id !== movingNode.__id)
    }

    newParent.Children = Array.isArray(newParent.Children) ? newParent.Children : []
    newParent.Children.push(movingNode)
    refreshParentLinks(currentData, null)
    return true
}

function countSubtreeNodes(node) {
    if (!node) {
        return 0
    }

    let total = 1
    for (const child of node.Children || []) {
        total += countSubtreeNodes(child)
    }
    return total
}

function deleteNode(nodeId) {
    if (!currentData || !nodeId || currentData.__id === nodeId) {
        return null
    }

    const parent = findParentById(currentData, nodeId)
    if (!parent || !Array.isArray(parent.Children)) {
        return null
    }

    const target = parent.Children.find((child) => child.__id === nodeId)
    if (!target) {
        return null
    }

    const removedCount = countSubtreeNodes(target)
    const removedName = target.Name || "Unnamed"
    parent.Children = parent.Children.filter((child) => child.__id !== nodeId)

    if (selectedNodeId === nodeId || isDescendant(target, selectedNodeId)) {
        selectedNodeId = parent.__id || currentData.__id
    }

    refreshParentLinks(currentData, null)
    return { name: removedName, count: removedCount }
}

function refreshParentLinks(node, parentId) {
    if (!node) {
        return
    }

    node.__parentId = parentId
    for (const child of node.Children || []) {
        refreshParentLinks(child, node.__id)
    }
}

function renderWorkspace() {
    treeBuilder.innerHTML = ""

    if (!currentData) {
        treeBuilder.innerHTML = '<div class="empty-builder">Load a saved map from the API to begin building a manual topology.</div>'
        detailsEl.textContent = "Load a saved map from the API to inspect and edit nodes."
        addSwitchButton.disabled = true
        saveJsonButton.disabled = !(currentUser && currentApiKey)
        return
    }

    const shell = document.createElement("div")
    shell.className = "tree-shell"
    if (currentViewMode === "builder") {
        shell.appendChild(renderNode(currentData, true))
    } else {
        shell.appendChild(renderGlobalView(currentData))
    }
    treeBuilder.appendChild(shell)

    renderDetails()
}

function renderGlobalView(root) {
    const overview = document.createElement("div")
    overview.className = "global-overview"

    const header = document.createElement("div")
    header.className = "global-overview-header"
    header.innerHTML = "<strong>Read-only wired overview</strong><span>Choose a preset to control how much information is shown.</span>"
    overview.appendChild(header)

    overview.appendChild(renderGlobalViewModePicker())

    const mode = getGlobalModeConfig(currentGlobalViewMode)
    if (mode.key === "summary") {
        overview.appendChild(renderGlobalSummary(root))
        return overview
    }

    if (mode.key === "tree") {
        overview.appendChild(renderGlobalLegend())
        overview.appendChild(renderGlobalTreeTopology(root))
        return overview
    }

    if (mode.key === "list") {
        overview.appendChild(renderGlobalHierarchyList(root))
        return overview
    }

    const viewRoot = getGlobalViewRoot(root, mode.key)
    if (!viewRoot) {
        const empty = document.createElement("div")
        empty.className = "empty-drop"
        empty.textContent = "No nodes match this preset."
        overview.appendChild(empty)
        return overview
    }

    overview.appendChild(renderGlobalLegend())

    const levels = collectLevels(viewRoot)
    const map = document.createElement("div")
    map.className = "global-map"
    if (mode.key === "simple") {
        map.classList.add("global-map-simple")
    }

    const connectorLayer = document.createElementNS("http://www.w3.org/2000/svg", "svg")
    connectorLayer.classList.add("global-connectors")
    connectorLayer.setAttribute("aria-hidden", "true")

    levels.forEach((level, depth) => {
        const column = document.createElement("section")
        column.className = "global-column"

        const columnTitle = document.createElement("div")
        columnTitle.className = "global-column-title"
        columnTitle.textContent = depth === 0 ? "Gateway" : `Depth ${depth}`
        column.appendChild(columnTitle)

        level.forEach((node) => {
            column.appendChild(renderGlobalNode(node, depth, mode.key))
        })

        map.appendChild(column)
    })

    map.appendChild(connectorLayer)
    overview.appendChild(map)

    requestAnimationFrame(() => drawGlobalConnectors(map, connectorLayer, viewRoot))
    return overview
}

function renderGlobalViewModePicker() {
    const wrap = document.createElement("div")
    wrap.className = "global-mode-picker"

    const label = document.createElement("label")
    label.setAttribute("for", "global-view-mode")
    label.textContent = "View Preset"

    const select = document.createElement("select")
    select.id = "global-view-mode"

    for (const mode of GLOBAL_VIEW_MODES) {
        const option = document.createElement("option")
        option.value = mode.key
        option.textContent = mode.label
        option.selected = mode.key === currentGlobalViewMode
        select.appendChild(option)
    }

    const hint = document.createElement("div")
    hint.className = "global-mode-hint"
    hint.textContent = getGlobalModeConfig(currentGlobalViewMode).description

    select.addEventListener("change", () => {
        currentGlobalViewMode = select.value
        renderWorkspace()
    })

    wrap.appendChild(label)
    wrap.appendChild(select)
    wrap.appendChild(hint)
    return wrap
}

function getGlobalModeConfig(modeKey) {
    return GLOBAL_VIEW_MODES.find((mode) => mode.key === modeKey) || GLOBAL_VIEW_MODES[0]
}

function isInfrastructureCategory(category) {
    return ["gateway", "switch", "managed", "ap", "router"].includes(category)
}

function cloneTreeByFilter(node, includeFn) {
    if (!node) {
        return null
    }

    const keptChildren = []
    for (const child of node.Children || []) {
        const kept = cloneTreeByFilter(child, includeFn)
        if (kept) {
            keptChildren.push(kept)
        }
    }

    const keepSelf = includeFn(node)
    if (!keepSelf && keptChildren.length === 0) {
        return null
    }

    return {
        ...node,
        Children: keptChildren
    }
}

function getGlobalViewRoot(root, modeKey) {
    if (modeKey === "infra") {
        return cloneTreeByFilter(root, (node) => isInfrastructureCategory(getGlobalCategory(node)))
    }

    if (modeKey === "endpoints") {
        return cloneTreeByFilter(root, (node) => !isInfrastructureCategory(getGlobalCategory(node)))
    }

    return root
}

function collectCategoryCounts(root) {
    const counts = new Map()

    const visit = (node) => {
        const category = getGlobalCategory(node)
        counts.set(category, (counts.get(category) || 0) + 1)
        for (const child of node.Children || []) {
            visit(child)
        }
    }

    visit(root)
    return counts
}

function renderGlobalSummary(root) {
    const summary = document.createElement("div")
    summary.className = "global-summary"

    const counts = collectCategoryCounts(root)
    const total = Array.from(counts.values()).reduce((sum, value) => sum + value, 0)

    const totalCard = document.createElement("article")
    totalCard.className = "global-summary-card total"
    totalCard.innerHTML = `<strong>${total}</strong><span>Total devices</span>`
    summary.appendChild(totalCard)

    const orderedCategories = ["gateway", "switch", "managed", "ap", "router", "server", "workstation", "printer", "camera", "endpoint", "unknown"]
    for (const category of orderedCategories) {
        const value = counts.get(category) || 0
        if (value === 0) {
            continue
        }

        const card = document.createElement("article")
        card.className = "global-summary-card"

        const swatch = document.createElement("span")
        swatch.className = "global-legend-swatch"
        swatch.style.background = getGlobalCategoryColor(category)

        const label = document.createElement("span")
        label.className = "global-summary-label"
        label.textContent = category

        const count = document.createElement("strong")
        count.textContent = String(value)

        card.appendChild(swatch)
        card.appendChild(label)
        card.appendChild(count)
        summary.appendChild(card)
    }

    return summary
}

function renderGlobalTreeTopology(root) {
    const tree = document.createElement("div")
    tree.className = "global-tree-view"

    const levels = collectLevels(root)
    levels.forEach((level, depth) => {
        const row = document.createElement("div")
        row.className = "global-tree-row"
        row.dataset.depth = String(depth)

        for (const node of level) {
            row.appendChild(renderGlobalTreeDiagramNode(node))
        }

        tree.appendChild(row)
    })

    const connectorLayer = document.createElementNS("http://www.w3.org/2000/svg", "svg")
    connectorLayer.classList.add("global-tree-connectors")
    connectorLayer.setAttribute("aria-hidden", "true")
    tree.appendChild(connectorLayer)

    requestAnimationFrame(() => drawGlobalTreeConnectors(tree, connectorLayer, root))
    return tree
}

function shortenTreeLabel(name, maxLength = 18) {
    if (!name) {
        return "Unnamed"
    }

    if (name.length <= maxLength) {
        return name
    }

    return `${name.slice(0, maxLength - 1)}…`
}

function renderGlobalTreeDiagramNode(node) {
    const card = document.createElement("article")
    card.className = "global-tree-card"
    card.dataset.nodeId = node.__id
    card.dataset.category = getGlobalCategory(node)
    const header = document.createElement("div")
    header.className = "global-node-header"

    const icon = document.createElement("span")
    icon.className = "node-icon"
    icon.textContent = resolveNodeIcon(node)

    const copy = document.createElement("div")
    copy.className = "node-copy"

    const title = document.createElement("strong")
    title.className = "global-tree-name"
    title.textContent = shortenTreeLabel(node.Name || "Unnamed")

    const subtitle = document.createElement("div")
    subtitle.className = "global-tree-subtitle"
    subtitle.textContent = node.IPAddress || node.Type || "-"

    copy.appendChild(title)
    copy.appendChild(subtitle)
    header.appendChild(icon)
    header.appendChild(copy)
    card.appendChild(header)

    const childCount = Array.isArray(node.Children) ? node.Children.length : 0
    if (childCount > 0) {
        const countBadge = document.createElement("span")
        countBadge.className = "global-tree-child-count"
        countBadge.textContent = String(childCount)
        card.appendChild(countBadge)
    }

    return card
}

function drawGlobalTreeConnectors(tree, connectorLayer, rootNode) {
    if (!tree || !connectorLayer || !rootNode) {
        return
    }

    while (connectorLayer.firstChild) {
        connectorLayer.removeChild(connectorLayer.firstChild)
    }

    const treeRect = tree.getBoundingClientRect()
    const nodeElements = new Map()
    for (const element of tree.querySelectorAll(".global-tree-card")) {
        nodeElements.set(element.dataset.nodeId, element)
    }

    const width = treeRect.width
    const height = treeRect.height
    connectorLayer.setAttribute("width", String(width))
    connectorLayer.setAttribute("height", String(height))
    connectorLayer.setAttribute("viewBox", `0 0 ${width} ${height}`)

    const drawLine = (parentEl, childEl) => {
        const parentRect = parentEl.getBoundingClientRect()
        const childRect = childEl.getBoundingClientRect()
        const startX = parentRect.left + parentRect.width / 2 - treeRect.left
        const startY = parentRect.bottom - treeRect.top
        const endX = childRect.left + childRect.width / 2 - treeRect.left
        const endY = childRect.top - treeRect.top
        const midY = startY + (endY - startY) * 0.5

        const path = document.createElementNS("http://www.w3.org/2000/svg", "path")
        path.setAttribute("d", `M ${startX} ${startY} V ${midY} H ${endX} V ${endY}`)
        path.setAttribute("fill", "none")
        path.setAttribute("stroke", "#2b80c5")
        path.setAttribute("stroke-width", "2.4")
        path.setAttribute("stroke-linecap", "round")
        path.setAttribute("stroke-linejoin", "round")
        connectorLayer.appendChild(path)
    }

    const visit = (node) => {
        const parentEl = nodeElements.get(node.__id)
        if (!parentEl) {
            return
        }

        for (const child of node.Children || []) {
            const childEl = nodeElements.get(child.__id)
            if (childEl) {
                drawLine(parentEl, childEl)
            }
            visit(child)
        }
    }

    visit(rootNode)
}

function collectHierarchyRows(root) {
    const rows = []

    const visit = (node, depth, parentName, pathParts) => {
        const name = node.Name || "Unnamed"
        const path = [...pathParts, name]
        rows.push({
            node,
            depth,
            parentName,
            path: path.join(" > ")
        })

        for (const child of node.Children || []) {
            visit(child, depth + 1, name, path)
        }
    }

    visit(root, 0, "-", [])
    return rows
}

function renderGlobalHierarchyList(root) {
    const list = document.createElement("div")
    list.className = "global-list-view"

    const header = document.createElement("div")
    header.className = "global-list-header"
    header.innerHTML = "<span>Device</span><span>Type</span><span>IP</span><span>Parent</span>"
    list.appendChild(header)

    const rows = collectHierarchyRows(root)
    for (const row of rows) {
        const item = document.createElement("article")
        item.className = "global-list-row"
        item.dataset.category = getGlobalCategory(row.node)

        const deviceCell = document.createElement("div")
        deviceCell.className = "global-list-device"
        deviceCell.style.paddingLeft = `${row.depth * 1.05}rem`

        const icon = document.createElement("span")
        icon.className = "node-icon"
        icon.textContent = resolveNodeIcon(row.node)

        const deviceText = document.createElement("div")
        const name = document.createElement("strong")
        name.textContent = row.node.Name || "Unnamed"
        const path = document.createElement("div")
        path.className = "global-list-path"
        path.textContent = row.path

        deviceText.appendChild(name)
        deviceText.appendChild(path)
        deviceCell.appendChild(icon)
        deviceCell.appendChild(deviceText)

        const typeCell = document.createElement("div")
        typeCell.textContent = row.node.Type || "Unknown"

        const ipCell = document.createElement("div")
        ipCell.textContent = row.node.IPAddress || "-"

        const parentCell = document.createElement("div")
        parentCell.textContent = row.parentName || "-"

        item.appendChild(deviceCell)
        item.appendChild(typeCell)
        item.appendChild(ipCell)
        item.appendChild(parentCell)
        list.appendChild(item)
    }

    return list
}

function renderGlobalLegend() {
    const legend = document.createElement("div")
    legend.className = "global-legend"

    const categories = [
        ["gateway", "Gateway"],
        ["switch", "Dumb Switch"],
        ["managed", "Managed Device"],
        ["ap", "Access Point"],
        ["router", "Router"],
        ["server", "Server"],
        ["workstation", "Workstation"],
        ["printer", "Printer"],
        ["camera", "Camera"],
        ["endpoint", "Other Endpoint"],
        ["unknown", "Unknown"]
    ]

    for (const [category, label] of categories) {
        const item = document.createElement("span")
        item.className = "global-legend-item"

        const swatch = document.createElement("span")
        swatch.className = "global-legend-swatch"
        swatch.style.background = getGlobalCategoryColor(category)

        const text = document.createElement("span")
        text.textContent = label

        item.appendChild(swatch)
        item.appendChild(text)
        legend.appendChild(item)
    }

    return legend
}

function collectLevels(root) {
    const levels = []

    function visit(node, depth) {
        if (!levels[depth]) {
            levels[depth] = []
        }

        levels[depth].push(node)

        for (const child of node.Children || []) {
            visit(child, depth + 1)
        }
    }

    visit(root, 0)
    return levels
}

function renderGlobalNode(node, depth, modeKey = "full") {
    const card = document.createElement("article")
    card.className = `global-node depth-${Math.min(depth, 4)}`
    card.dataset.nodeId = node.__id
    card.dataset.category = getGlobalCategory(node)
    if (modeKey === "simple") {
        card.classList.add("global-node-simple")
    }

    const header = document.createElement("div")
    header.className = "global-node-header"

    const icon = document.createElement("span")
    icon.className = "node-icon"
    icon.textContent = resolveNodeIcon(node)

    const copy = document.createElement("div")
    copy.className = "node-copy"

    const title = document.createElement("strong")
    title.className = "node-name"
    title.textContent = node.Name || "Unnamed"

    const subtitle = document.createElement("div")
    subtitle.className = "node-subtitle"
    subtitle.textContent = modeKey === "simple"
        ? [node.Type, node.IPAddress].filter(Boolean).join(" · ")
        : [node.Type, node.RoleGuess, node.IPAddress].filter(Boolean).join(" · ")

    copy.appendChild(title)
    copy.appendChild(subtitle)

    header.appendChild(icon)
    header.appendChild(copy)
    card.appendChild(header)

    const meta = document.createElement("div")
    meta.className = "global-node-meta"
    const childCount = Array.isArray(node.Children) ? node.Children.length : 0
    const parts = []
    if (node.IPAddress) { parts.push(node.IPAddress) }
    if (node.Type) { parts.push(node.Type) }
    if (node.RoleGuess) { parts.push(node.RoleGuess) }
    if (childCount > 0) {
        parts.push(`${childCount} child${childCount === 1 ? "" : "ren"}`)
    }
    if (modeKey !== "simple") {
        if (parts.length > 0) {
            meta.textContent = parts.join(" · ")
            card.appendChild(meta)
        }
    }

    return card
}

function getGlobalCategory(node) {
    if (!node) {
        return "unknown"
    }

    if (node.Type === "Gateway") {
        return "gateway"
    }
    if (node.Type === "Dumb-Switch") {
        return "switch"
    }
    if (node.Type === "Managed-Network-Device") {
        return "managed"
    }

    const role = String(node.RoleGuess || "").toLowerCase()
    if (role.includes("ap") || role.includes("access point")) { return "ap" }
    if (role.includes("router")) { return "router" }
    if (role.includes("server") || role.includes("linux") || role.includes("windows")) { return "server" }
    if (role.includes("printer")) { return "printer" }
    if (role.includes("camera")) { return "camera" }
    if (role.includes("workstation")) { return "workstation" }

    return "endpoint"
}

function getGlobalCategoryColor(category) {
    switch (category) {
        case "gateway":
            return "#0b3c5d"
        case "switch":
            return "#365d4b"
        case "managed":
            return "#1d6f42"
        case "ap":
            return "#2b80c5"
        case "router":
            return "#3a5ba0"
        case "server":
            return "#6a4c93"
        case "printer":
            return "#9a6b2f"
        case "camera":
            return "#8f3d4a"
        case "workstation":
            return "#5d6f3a"
        default:
            return "#7a2230"
    }
}

function drawGlobalConnectors(map, connectorLayer, rootNode) {
    if (!map || !connectorLayer) {
        return
    }

    while (connectorLayer.firstChild) {
        connectorLayer.removeChild(connectorLayer.firstChild)
    }

    const mapRect = map.getBoundingClientRect()
    const nodeElements = new Map()

    for (const element of map.querySelectorAll(".global-node")) {
        nodeElements.set(element.dataset.nodeId, element)
    }

    const width = mapRect.width
    const height = mapRect.height
    connectorLayer.setAttribute("width", String(width))
    connectorLayer.setAttribute("height", String(height))
    connectorLayer.setAttribute("viewBox", `0 0 ${width} ${height}`)

    function line(parentEl, childEl, childNode) {
        const parentRect = parentEl.getBoundingClientRect()
        const childRect = childEl.getBoundingClientRect()
        const startX = parentRect.right - mapRect.left
        const startY = parentRect.top + parentRect.height / 2 - mapRect.top
        const endX = childRect.left - mapRect.left
        const endY = childRect.top + childRect.height / 2 - mapRect.top
        const category = getGlobalCategory(childNode)
        const stroke = getGlobalCategoryColor(category)

        const path = document.createElementNS("http://www.w3.org/2000/svg", "path")
        const curveX = Math.max(18, (endX - startX) * 0.45)
        const d = `M ${startX} ${startY} C ${startX + curveX} ${startY}, ${endX - curveX} ${endY}, ${endX} ${endY}`
        path.setAttribute("d", d)
        path.setAttribute("fill", "none")
        path.setAttribute("stroke", stroke)
        path.setAttribute("stroke-opacity", "0.9")
        path.setAttribute("stroke-width", category === "gateway" ? "3.2" : "2.6")
        path.setAttribute("stroke-dasharray", "")
        path.setAttribute("stroke-linecap", "round")
        connectorLayer.appendChild(path)
    }

    const visit = (node) => {
        const parentEl = nodeElements.get(node.__id)
        if (!parentEl) {
            return
        }

        for (const child of node.Children || []) {
            const childEl = nodeElements.get(child.__id)
            if (childEl) {
                line(parentEl, childEl, child)
            }
            visit(child)
        }
    }

    visit(rootNode)
}

function renderNode(node, isRoot = false) {
    const nodeCard = document.createElement("article")
    nodeCard.className = `tree-node${isRoot ? " root-node" : ""}${selectedNodeId === node.__id ? " selected" : ""}`
    nodeCard.dataset.nodeId = node.__id
    nodeCard.draggable = false

    nodeCard.addEventListener("click", (event) => {
        event.stopPropagation()
        selectedNodeId = node.__id
        renderWorkspace()
    })

    const dragHandle = document.createElement("span")
    dragHandle.className = "drag-handle"
    dragHandle.textContent = "⋮⋮"
    dragHandle.draggable = !isRoot
    dragHandle.title = isRoot ? "Root node cannot be moved" : "Drag to move"

    dragHandle.addEventListener("dragstart", (event) => {
        if (isRoot) {
            event.preventDefault()
            return
        }

        draggedNodeId = node.__id
        event.dataTransfer.effectAllowed = "move"
        event.dataTransfer.setData("text/plain", node.__id)
        window.setTimeout(() => nodeCard.classList.add("dragging"), 0)
    })

    dragHandle.addEventListener("dragend", () => {
        draggedNodeId = null
        clearDropTargets()
        nodeCard.classList.remove("dragging")
    })

    if (canAcceptChildren(node)) {
        nodeCard.addEventListener("dragover", (event) => {
            if (setDropTarget(event, nodeCard, node.__id)) {
                return
            }
        })

        nodeCard.addEventListener("dragleave", () => {
            nodeCard.classList.remove("drop-target")
        })

        nodeCard.addEventListener("drop", (event) => {
            handleNodeDrop(event, node)
        })
    }

    const header = document.createElement("div")
    header.className = "node-header"

    const icon = document.createElement("span")
    icon.className = "node-icon"
    icon.textContent = resolveNodeIcon(node)

    const copy = document.createElement("div")
    copy.className = "node-copy"

    const titleRow = document.createElement("div")
    titleRow.className = "node-title-row"

    const title = document.createElement("strong")
    title.className = "node-name"
    title.textContent = node.Name || "Unnamed"

    const typeBadge = document.createElement("span")
    typeBadge.className = "node-badge"
    typeBadge.textContent = node.Type || "Unknown"

    titleRow.appendChild(title)
    titleRow.appendChild(typeBadge)

    const subtitle = document.createElement("div")
    subtitle.className = "node-subtitle"
    subtitle.textContent = [node.RoleGuess, node.IPAddress].filter(Boolean).join(" · ")

    copy.appendChild(titleRow)
    copy.appendChild(subtitle)

    header.appendChild(icon)
    header.appendChild(copy)

    if (!isRoot) {
        const deleteButton = document.createElement("button")
        deleteButton.type = "button"
        deleteButton.className = "node-delete-button"
        deleteButton.textContent = "Delete"
        deleteButton.title = "Delete this device and its children"
        deleteButton.addEventListener("click", (event) => {
            event.preventDefault()
            event.stopPropagation()

            const confirmed = window.confirm(`Delete ${node.Name || "this device"}? Any child nodes will also be removed.`)
            if (!confirmed) {
                return
            }

            const result = deleteNode(node.__id)
            if (!result) {
                setStatus("Could not delete this node.", true)
                return
            }

            const suffix = result.count > 1 ? ` and ${result.count - 1} child node${result.count - 1 === 1 ? "" : "s"}` : ""
            setStatus(`Deleted ${result.name}${suffix}. Save changes to update the database.`)
            renderWorkspace()
        })
        header.appendChild(deleteButton)
    }

    header.insertBefore(dragHandle, icon)
    nodeCard.appendChild(header)

    const childCount = Array.isArray(node.Children) ? node.Children.length : 0
    const metaRow = document.createElement("div")
    metaRow.className = "node-meta-row"
    if (childCount > 0) {
        metaRow.textContent = `${childCount} child node${childCount === 1 ? "" : "s"}`
        nodeCard.appendChild(metaRow)
    }

    if (canAcceptChildren(node)) {
        const dropStrip = document.createElement("div")
        dropStrip.className = "drop-strip"
        dropStrip.textContent = "Drop here to attach this device/switch"
        dropStrip.addEventListener("dragover", (event) => {
            if (setDropTarget(event, nodeCard, node.__id, dropStrip)) {
                return
            }
        })
        dropStrip.addEventListener("dragleave", () => {
            nodeCard.classList.remove("drop-target")
            dropStrip.classList.remove("drop-strip-active")
        })
        dropStrip.addEventListener("drop", (event) => {
            handleNodeDrop(event, node)
        })

        nodeCard.appendChild(dropStrip)

        const dropZone = document.createElement("div")
        dropZone.className = "children-wrap drop-zone"
        dropZone.addEventListener("dragover", (event) => {
            if (setDropTarget(event, dropZone, node.__id)) {
                return
            }
        })
        dropZone.addEventListener("dragleave", () => dropZone.classList.remove("drop-target"))
        dropZone.addEventListener("drop", (event) => {
            handleNodeDrop(event, node)
        })

        const children = Array.isArray(node.Children) ? node.Children : []
        if (children.length === 0) {
            const empty = document.createElement("div")
            empty.className = "empty-drop"
            empty.textContent = node.Type === "Gateway" ? "Drop switches or devices here." : "Drop devices or nested switches here."
            dropZone.appendChild(empty)
        } else {
            for (const child of children) {
                dropZone.appendChild(renderNode(child, false))
            }
        }

        nodeCard.appendChild(dropZone)
    }

    return nodeCard
}

function canDropOnTarget(movingNodeId, targetNodeId) {
    const movingNode = findNodeById(currentData, movingNodeId)
    const targetNode = findNodeById(currentData, targetNodeId)

    if (!movingNode || !targetNode) {
        return false
    }

    if (!canAcceptChildren(targetNode)) {
        return false
    }

    if (movingNode.__id === targetNode.__id) {
        return false
    }

    if (isDescendant(movingNode, targetNode.__id)) {
        return false
    }

    return true
}

function setDropTarget(event, element, targetNodeId, extraElement = null) {
    if (!draggedNodeId || !canDropOnTarget(draggedNodeId, targetNodeId)) {
        return false
    }

    event.preventDefault()
    element.classList.add("drop-target")
    if (extraElement) {
        extraElement.classList.add("drop-strip-active")
    }
    event.dataTransfer.dropEffect = "move"
    return true
}

function handleNodeDrop(event, targetNode) {
    event.preventDefault()
    event.stopPropagation()
    clearDropTargets()

    const movingId = draggedNodeId || event.dataTransfer.getData("text/plain")
    if (!movingId) {
        return
    }

    if (moveNode(movingId, targetNode.__id)) {
        selectedNodeId = targetNode.__id
        setStatus(`Moved node under ${targetNode.Name || "selected switch"}.`)
        renderWorkspace()
    }
}

function clearDropTargets() {
    for (const element of document.querySelectorAll(".drop-target")) {
        element.classList.remove("drop-target")
    }
    for (const element of document.querySelectorAll(".drop-strip-active")) {
        element.classList.remove("drop-strip-active")
    }
}

function renderDetails() {
    const node = getSelectedNode()
    if (!node) {
        detailsEl.textContent = "Load a saved map from the API to inspect and edit nodes."
        return
    }

    if (currentViewMode === "global") {
        detailsEl.innerHTML = `
        <h3>Global Wired View</h3>
        <pre class="metadata-block">${escapeHtml(formatNodeMetadata(node))}</pre>
        <p class="details-note">Switch back to Topology Builder to edit names, icons, admin values, or wiring.</p>
      `
        return
    }

    const currentName = node.Name || ""
    const currentAdminUser = node.AdminUser || ""
    const currentAdminPassword = node.AdminPassword || ""
    const currentIconKey = node.DeviceIconKey || "auto"

    detailsEl.innerHTML = `
    <form id="node-edit-form" class="node-edit-form">
      <label for="device-name">Device Name</label>
      <input id="device-name" name="device-name" type="text" value="${escapeHtml(currentName)}">

      <label for="device-icon-key">Device Icon Type</label>
      <select id="device-icon-key" name="device-icon-key">
        ${buildIconOptions(currentIconKey)}
      </select>

      <label for="admin-user">Admin User</label>
      <input id="admin-user" name="admin-user" type="text" value="${escapeHtml(currentAdminUser)}" autocomplete="off">

      <label for="admin-password">Admin Password</label>
      <input id="admin-password" name="admin-password" type="text" value="${escapeHtml(currentAdminPassword)}" autocomplete="off">

      <button type="submit">Apply To Node</button>
    </form>

    <h3>Node Metadata</h3>
    <pre class="metadata-block">${escapeHtml(formatNodeMetadata(node))}</pre>

    <p class="details-note">Drag a device onto a dumb switch, or drag a switch into another switch to cascade them.</p>
  `

    const form = document.getElementById("node-edit-form")
    form.addEventListener("submit", (event) => {
        event.preventDefault()
        const nameInput = document.getElementById("device-name")
        const iconKeyInput = document.getElementById("device-icon-key")
        const adminUserInput = document.getElementById("admin-user")
        const adminPasswordInput = document.getElementById("admin-password")

        const updatedName = nameInput.value.trim()
        const iconKey = iconKeyInput.value
        const typeAndRole = getTypeAndRoleFromIconKey(iconKey, node.Type, node.RoleGuess)

        node.Name = updatedName || node.Name || "Unnamed"
        node.DeviceIconKey = iconKey
        node.Type = typeAndRole.Type
        node.RoleGuess = typeAndRole.RoleGuess
        node.DeviceIcon = iconKey === "auto" ? "" : getIconFromKey(iconKey)
        node.AdminUser = adminUserInput.value.trim()
        node.AdminPassword = adminPasswordInput.value

        setStatus("Node updated. Save changes to update the database.")
        renderWorkspace()
    })
}

function formatNodeMetadata(node) {
    const lines = []
    for (const [key, value] of Object.entries(node)) {
        if (key.startsWith("__") || key === "Children") {
            continue
        }

        if (Array.isArray(value)) {
            lines.push(`${key}: ${value.join(", ")}`)
            continue
        }

        if (value && typeof value === "object") {
            lines.push(`${key}: ${JSON.stringify(value)}`)
            continue
        }

        lines.push(`${key}: ${value}`)
    }

    return lines.join("\n")
}

function buildIconOptions(selectedKey) {
    return ICON_CHOICES.map((option) => {
        const selected = option.key === selectedKey ? " selected" : ""
        return `<option value="${option.key}"${selected}>${option.icon} ${option.label}</option>`
    }).join("")
}

function getTypeAndRoleFromIconKey(iconKey, currentType, currentRoleGuess) {
    switch (iconKey) {
        case "gateway":
            return { Type: "Gateway", RoleGuess: "Router" }
        case "router":
            return { Type: "Managed-Network-Device", RoleGuess: "Router" }
        case "switch":
            return { Type: "Dumb-Switch", RoleGuess: "Switch" }
        case "switch-poe":
            return { Type: "Dumb-Switch", RoleGuess: "Switch-POE" }
        case "ap":
            return { Type: "Managed-Network-Device", RoleGuess: "Access-Point" }
        case "server":
            return { Type: "End-Device", RoleGuess: "Linux-Or-Network-Appliance" }
        case "nas":
            return { Type: "NAS", RoleGuess: "Network-Attached-Storage" }
        case "laptop":
            return { Type: "Laptop", RoleGuess: "Laptop" }
        case "mobile":
            return { Type: "Mobile-Phone", RoleGuess: "Mobile-Phone" }
        case "workstation":
            return { Type: "End-Device", RoleGuess: "Windows-Host" }
        case "printer":
            return { Type: "End-Device", RoleGuess: "Printer" }
        case "camera":
            return { Type: "End-Device", RoleGuess: "Camera-Or-NVR" }
        case "iot":
            return { Type: "End-Device", RoleGuess: "IoT-Device" }
        case "unknown":
            return { Type: "End-Device", RoleGuess: "Unknown-End-Device" }
        default:
            return { Type: currentType || "End-Device", RoleGuess: currentRoleGuess || "Unknown-End-Device" }
    }
}

function resolveNodeIcon(node) {
    if (node.DeviceIcon) {
        return node.DeviceIcon
    }

    const key = node.DeviceIconKey || inferIconKey(node)
    return getIconFromKey(key)
}

function inferIconKey(node) {
    if (node.Type === "Gateway") {
        return "gateway"
    }

    const type = (node.Type || "").toLowerCase()
    if (type.includes("nas")) { return "nas" }
    if (type.includes("laptop")) { return "laptop" }
    if (type.includes("mobile")) { return "mobile" }

    const role = (node.RoleGuess || "").toLowerCase()
    if (role.includes("router")) { return "router" }
    if (role.includes("poe") && role.includes("switch")) { return "switch-poe" }
    if (role.includes("switch")) { return "switch" }
    if (role.includes("ap") || role.includes("access point")) { return "ap" }
    if (role.includes("nas") || role.includes("storage")) { return "nas" }
    if (role.includes("laptop")) { return "laptop" }
    if (role.includes("mobile") || role.includes("phone")) { return "mobile" }
    if (role.includes("server")) { return "server" }
    if (role.includes("printer")) { return "printer" }
    if (role.includes("camera")) { return "camera" }
    if (role.includes("workstation") || role.includes("windows") || role.includes("linux")) { return "workstation" }

    if (node.Type === "Managed-Network-Device") {
        return "switch"
    }

    return "unknown"
}

function getIconFromKey(key) {
    const found = ICON_CHOICES.find((choice) => choice.key === key)
    return found ? found.icon : "❔"
}

function countNodesByType(node, type) {
    if (!node) {
        return 0
    }

    let count = node.Type === type ? 1 : 0
    for (const child of node.Children || []) {
        count += countNodesByType(child, type)
    }
    return count
}

function serializeNode(node) {
    const serialized = {}

    for (const [key, value] of Object.entries(node)) {
        if (key.startsWith("__")) {
            continue
        }

        if (key === "Children") {
            serialized.Children = Array.isArray(value) ? value.map((child) => serializeNode(child)) : []
            continue
        }

        if (Array.isArray(value)) {
            serialized[key] = value.map((item) => cloneSerializable(item))
            continue
        }

        serialized[key] = cloneSerializable(value)
    }

    return serialized
}

function cloneSerializable(value) {
    if (Array.isArray(value)) {
        return value.map((item) => cloneSerializable(item))
    }

    if (value && typeof value === "object") {
        const copy = {}
        for (const [key, entry] of Object.entries(value)) {
            if (key.startsWith("__")) {
                continue
            }

            copy[key] = cloneSerializable(entry)
        }
        return copy
    }

    return value
}

function escapeHtml(text) {
    return String(text)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;")
}

async function saveCurrentJson() {
    if (!currentData) {
        setStatus("Load data before saving.", true)
        return
    }

    setStatus("Saving changes to database...")
    try {
        const selectedMapId = savedMapsSelect.value ? Number(savedMapsSelect.value) : null
        const requestBody = JSON.stringify({
            name: currentData.MapName || currentData.Name || "Network Map",
            map: serializeNode(currentData)
        })

        const payload = selectedMapId
            ? await apiRequest(`/maps/${selectedMapId}`, {
                method: "PUT",
                body: requestBody
            })
            : await apiRequest("/maps", {
                method: "POST",
                body: requestBody
            })

        currentMapId = Number(payload.id)
        lastLoadedName = `${payload.name || "NetworkMap"}.json`
        await refreshSavedMaps()
        savedMapsSelect.value = String(currentMapId)
        loadSelectedMapButton.disabled = false
        deleteSelectedMapButton.disabled = false
        setStatus(selectedMapId ? `Updated map: ${payload.name || `#${currentMapId}`}.` : `Created new map: ${payload.name || `#${currentMapId}`}.`)
    } catch (error) {
        setStatus("Could not save changes to database.", true)
        console.error(error)
    }
}

setStatus("Ready. Refresh saved maps and load one to edit.")
setMapControlsEnabled(false)
syncAuthState().catch((error) => {
    setStatus("Could not initialize auth state.", true)
    console.error(error)
})
