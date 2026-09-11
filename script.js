// Global App State
let inventoryList = [];
let currentUserData = null;
let db = null;

// Force Hide Loading Screen Guard
function forceHideSplash() {
    const splash = document.getElementById('appSplashLoader');
    if (splash) {
        splash.style.display = 'none';
        splash.classList.add('hidden');
    }
}

// App Entry Point
document.addEventListener("DOMContentLoaded", () => {
    // Fail-safe loader timeout (max 1 second wait)
    setTimeout(forceHideSplash, 1000);

    initFirebaseSafely();
    loadLocalInventory();
    setupNetworkListeners();
    setupEventListeners();
});

// 1. Firebase Safe Initializer
function initFirebaseSafely() {
    try {
        if (typeof firebase !== 'undefined' && firebase.apps && firebase.apps.length > 0) {
            db = firebase.firestore();
            
            db.enablePersistence({ synchronizeTabs: true }).catch(err => {
                console.warn("Firestore Persistence Warning:", err.code);
            });

            fetchCloudInventory();
        } else {
            console.warn("Firebase not detected, operating in Local Mode.");
        }
    } catch (err) {
        console.error("Firebase init bypass:", err);
    } finally {
        forceHideSplash();
    }
}

// 2. Offline & Network Recovery Listener
function setupNetworkListeners() {
    window.addEventListener('online', () => {
        showToast("Internet Back Online!");
        updateNetworkStatusUI(true);
        fetchCloudInventory();
    });

    window.addEventListener('offline', () => {
        showToast("Offline Mode Active");
        updateNetworkStatusUI(false);
    });
}

function updateNetworkStatusUI(isOnline) {
    const statusPill = document.querySelector('.status-pill');
    if (statusPill) {
        statusPill.className = isOnline ? "status-pill green" : "status-pill red";
        statusPill.innerHTML = isOnline 
            ? `<span class="dot"></span> Live Cloud` 
            : `<span class="dot"></span> Offline`;
    }
}

// 3. Local Cache Operations
function loadLocalInventory() {
    try {
        const saved = localStorage.getItem('localInventoryData');
        if (saved) {
            inventoryList = JSON.parse(saved);
        }
    } catch (e) {
        inventoryList = [];
    }
    renderInventoryList();
}

function saveLocalInventory() {
    localStorage.setItem('localInventoryData', JSON.stringify(inventoryList));
    renderInventoryList();
}

// 4. Cloud Data Sync (Prevents overwriting previous items)
async function fetchCloudInventory() {
    const phone = localStorage.getItem('userPhone') || currentUserData?.phone;
    if (!db || !phone) {
        forceHideSplash();
        return;
    }

    try {
        const doc = await db.collection('inventories').doc(phone).get();
        if (doc.exists && doc.data().items) {
            const cloudItems = doc.data().items || [];
            
            // Map-based merging to maintain unique items
            const itemMap = new Map();
            inventoryList.forEach(item => itemMap.set(item.id || item.name.toLowerCase(), item));
            cloudItems.forEach(item => itemMap.set(item.id || item.name.toLowerCase(), item));
            
            inventoryList = Array.from(itemMap.values());
            saveLocalInventory();
        }
    } catch (err) {
        console.warn("Cloud Sync Warning:", err);
    } finally {
        forceHideSplash();
    }
}

// 5. Stock Addition (Fixes single-item replace issue)
async function uploadToCloudProcess() {
    const nameInput = document.getElementById('prodName');
    const qtyInput = document.getElementById('prodQty');
    
    const name = nameInput ? nameInput.value.trim() : '';
    const qty = qtyInput ? parseInt(qtyInput.value, 10) : 0;

    if (!name || isNaN(qty) || qty <= 0) {
        alert("Please enter a valid Product Name and Quantity.");
        return;
    }

    requestCancel('modalDetails');

    // Duplicate check
    const existingIndex = inventoryList.findIndex(item => item.name.toLowerCase() === name.toLowerCase());

    if (existingIndex > -1) {
        // Increment Qty if item exists
        inventoryList[existingIndex].qty += qty;
        inventoryList[existingIndex].lastUpdated = new Date().toISOString();
    } else {
        // Push NEW unique item
        const newItem = {
            id: 'item_' + Date.now(),
            name: name,
            qty: qty,
            lastUpdated: new Date().toISOString()
        };
        inventoryList.push(newItem);
    }

    saveLocalInventory();

    // Sync Cloud
    const phone = localStorage.getItem('userPhone') || currentUserData?.phone;
    if (db && phone) {
        try {
            await db.collection('inventories').doc(phone).set({
                items: inventoryList,
                lastUpdated: new Date().toISOString()
            }, { merge: true });
            showToast("Saved to Cloud!");
        } catch (error) {
            console.error("Cloud Save Failed:", error);
            showToast("Saved Locally");
        }
    } else {
        showToast("Saved Locally");
    }

    if (nameInput) nameInput.value = '';
    if (qtyInput) qtyInput.value = '';
}

// 6. UI Renders
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

function filterInventory() {
    const query = document.getElementById('searchInput')?.value.toLowerCase() || '';
    const cards = document.querySelectorAll('.stock-card');
    cards.forEach(card => {
        const name = card.querySelector('h4')?.innerText.toLowerCase() || '';
        card.style.display = name.includes(query) ? 'flex' : 'none';
    });
}

// UI Handlers
function showToast(msg) {
    const toast = document.getElementById('successPopUp');
    const msgEl = document.getElementById('popUpMessage');
    if (toast && msgEl) {
        msgEl.innerText = msg;
        toast.classList.remove('hidden');
        setTimeout(() => toast.classList.add('hidden'), 3000);
    }
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

function closeMenu() {
    const drawer = document.getElementById('menuDrawer');
    const backdrop = document.getElementById('drawerBackdrop');
    if (drawer) drawer.classList.remove('open');
    if (backdrop) backdrop.classList.remove('open');
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

function logoutUser() {
    localStorage.clear();
    location.reload();
}
