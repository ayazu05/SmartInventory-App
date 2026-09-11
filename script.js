// Global State
let inventoryList = [];
let currentUserData = null;
let currentPendingItem = null;
let db = null;

// Initialization
document.addEventListener("DOMContentLoaded", () => {
    initFirebase();
    loadLocalInventory();
    setupNetworkListeners();
    setupEventListeners();
});

// 1. Firebase Initialization & Reconnection Setup
function initFirebase() {
    try {
        if (typeof firebase !== 'undefined') {
            // Firebase Config (Aapka original config auto-load hoga)
            db = firebase.firestore();
            
            // Re-enable persistence for offline support
            db.enablePersistence({ synchronizeTabs: true }).catch(err => {
                console.warn("Persistence error:", err.code);
            });
            
            fetchCloudInventory();
        }
    } catch (e) {
        console.error("Firebase Init Error:", e);
    }
}

// 2. FIXED: Auto Refresh on Network Reconnect
function setupNetworkListeners() {
    window.addEventListener('online', () => {
        showToast("Internet Connected! Syncing Data...");
        updateNetworkStatusUI(true);
        // Internet aate hi cloud sync aur data re-fetch karega
        fetchCloudInventory();
    });

    window.addEventListener('offline', () => {
        showToast("Offline Mode Active. Data saved locally.");
        updateNetworkStatusUI(false);
    });
}

function updateNetworkStatusUI(isOnline) {
    const statusPill = document.querySelector('.status-pill');
    if (statusPill) {
        if (isOnline) {
            statusPill.className = "status-pill green";
            statusPill.innerHTML = `<span class="dot"></span> Live Cloud`;
        } else {
            statusPill.className = "status-pill red";
            statusPill.innerHTML = `<span class="dot"></span> Offline`;
        }
    }
}

// 3. Local Storage Handling
function loadLocalInventory() {
    const saved = localStorage.getItem('localInventoryData');
    if (saved) {
        try {
            inventoryList = JSON.parse(saved);
            renderInventoryList();
        } catch (e) {
            inventoryList = [];
        }
    }
}

function saveLocalInventory() {
    localStorage.setItem('localInventoryData', JSON.stringify(inventoryList));
    renderInventoryList();
}

// 4. Fetch Data from Firestore (Append-safe)
async function fetchCloudInventory() {
    const phone = localStorage.getItem('userPhone') || currentUserData?.phone;
    if (!db || !phone) return;

    try {
        const doc = await db.collection('inventories').doc(phone).get();
        if (doc.exists && doc.data().items) {
            // Merging local and cloud data to prevent loss
            const cloudItems = doc.data().items || [];
            
            // Unique ID basis par items merge karna
            const itemMap = new Map();
            inventoryList.forEach(item => itemMap.set(item.id || item.name, item));
            cloudItems.forEach(item => itemMap.set(item.id || item.name, item));
            
            inventoryList = Array.from(itemMap.values());
            saveLocalInventory();
        }
    } catch (err) {
        console.warn("Cloud Fetch Failed (Using Local Storage):", err);
    } finally {
        hideSplash();
    }
}

// 5. FIXED: Multiple Item Stock Addition (Prevents Overwriting)
async function uploadToCloudProcess() {
    const nameInput = document.getElementById('prodName');
    const qtyInput = document.getElementById('prodQty');
    
    const name = nameInput ? nameInput.value.trim() : '';
    const qty = qtyInput ? parseInt(qtyInput.value, 10) : 0;

    if (!name || isNaN(qty) || qty <= 0) {
        alert("Please enter a valid Name and Quantity.");
        return;
    }

    // Modal Hide
    requestCancel('modalDetails');
    showUploadProgress(true);

    // FIXED: Item update or Push Logic
    const existingIndex = inventoryList.findIndex(item => item.name.toLowerCase() === name.toLowerCase());

    if (existingIndex > -1) {
        // Agar item pehele se hai, toh uski Qty add/update karo (replace nahi)
        inventoryList[existingIndex].qty += qty;
        inventoryList[existingIndex].lastUpdated = new Date().toISOString();
    } else {
        // Naya Item create karke Array me Push karo (Purana delete nahi hoga)
        const newItem = {
            id: 'item_' + Date.now(),
            name: name,
            qty: qty,
            image: currentPendingItem?.image || '',
            lastUpdated: new Date().toISOString()
        };
        inventoryList.push(newItem);
    }

    // Local Storage Update immediately
    saveLocalInventory();

    // Cloud Database Save
    const phone = localStorage.getItem('userPhone') || currentUserData?.phone;
    if (db && phone) {
        try {
            await db.collection('inventories').doc(phone).set({
                items: inventoryList,
                lastUpdated: new Date().toISOString()
            }, { merge: true });
            
            updateProgress(100);
            showToast("Item saved to Cloud!");
        } catch (error) {
            console.error("Cloud Save Failed:", error);
            showToast("Saved Locally (Offline)");
        }
    } else {
        showToast("Saved Locally");
    }

    // Reset Form
    if (nameInput) nameInput.value = '';
    if (qtyInput) qtyInput.value = '';
    currentPendingItem = null;
    
    setTimeout(() => {
        showUploadProgress(false);
    }, 500);
}

// 6. UI Render Functions
function renderInventoryList() {
    const container = document.getElementById('stockListContainer');
    const totalItemsEl = document.getElementById('statTotalItems');
    const totalQtyEl = document.getElementById('statTotalQty');

    if (!container) return;

    container.innerHTML = '';
    let totalQty = 0;

    if (inventoryList.length === 0) {
        container.innerHTML = `<div class="empty-state"><p>No stock items available.</p></div>`;
    } else {
        inventoryList.forEach((item, index) => {
            totalQty += Number(item.qty) || 0;
            const card = document.createElement('div');
            card.className = 'stock-card';
            card.innerHTML = `
                <div class="stock-info">
                    <h4>${escapeHtml(item.name)}</h4>
                    <span class="qty-badge">Qty: ${item.qty}</span>
                </div>
                <button class="btn-delete" onclick="deleteStockItem(${index})" title="Delete Item">
                    <i class="fas fa-trash"></i>
                </button>
            `;
            container.appendChild(card);
        });
    }

    if (totalItemsEl) totalItemsEl.innerText = inventoryList.length;
    if (totalQtyEl) totalQtyEl.innerText = totalQty;
}

function deleteStockItem(index) {
    if (confirm("Are you sure you want to delete this item?")) {
        inventoryList.splice(index, 1);
        saveLocalInventory();
        
        // Sync Cloud
        const phone = localStorage.getItem('userPhone') || currentUserData?.phone;
        if (db && phone) {
            db.collection('inventories').doc(phone).set({
                items: inventoryList,
                lastUpdated: new Date().toISOString()
            }, { merge: true });
        }
        showToast("Item deleted");
    }
}

// Utility Functions
function showToast(msg) {
    const toast = document.getElementById('successPopUp');
    const msgEl = document.getElementById('popUpMessage');
    if (toast && msgEl) {
        msgEl.innerText = msg;
        toast.classList.remove('hidden');
        setTimeout(() => toast.classList.add('hidden'), 3000);
    }
}

function showUploadProgress(show) {
    const modal = document.getElementById('modalUploadProgress');
    if (modal) {
        if (show) modal.classList.remove('hidden');
        else modal.classList.add('hidden');
    }
}

function updateProgress(percent) {
    const bar = document.getElementById('uploadProgressBar');
    const text = document.getElementById('uploadPercentText');
    if (bar) bar.style.width = percent + '%';
    if (text) text.innerText = percent + '%';
}

function hideSplash() {
    const splash = document.getElementById('appSplashLoader');
    if (splash) splash.classList.add('hidden');
}

function requestCancel(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.classList.add('hidden');
}

function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, function(m) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[m];
    });
}

function setupEventListeners() {
    // Menu Drawer handlers
    const btnOpen = document.getElementById('btnOpenMenu');
    const btnClose = document.getElementById('btnCloseMenu');
    const drawer = document.getElementById('menuDrawer');
    const backdrop = document.getElementById('drawerBackdrop');

    if (btnOpen && drawer && backdrop) {
        btnOpen.onclick = () => {
            drawer.classList.add('open');
            backdrop.classList.add('open');
        };
    }

    if (btnClose && drawer && backdrop) {
        const closeFn = () => {
            drawer.classList.remove('open');
            backdrop.classList.remove('open');
        };
        btnClose.onclick = closeFn;
        backdrop.onclick = closeFn;
    }
}

function switchTab(tabName) {
    document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(btn => btn.classList.remove('active'));
    
    const targetTab = document.getElementById('tab' + tabName.charAt(0).toUpperCase() + tabName.slice(1));
    if (targetTab) targetTab.classList.add('active');
}

function handleStockIn() {
    const modal = document.getElementById('modalDetails');
    if (modal) modal.classList.remove('hidden');
}

function handleStockOut() {
    const modal = document.getElementById('modalStockOutSelect');
    if (modal) modal.classList.remove('hidden');
}
