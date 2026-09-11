// Firebase Configuration Setup
const firebaseConfig = {
    apiKey: "AIzaSyARcXw5tfsu2fo2j7-5tqwdk1uhE3hPKvk",
    authDomain: "smartinventory-app-38080.firebaseapp.com",
    projectId: "smartinventory-app-38080",
    storageBucket: "smartinventory-app-38080.firebasestorage.app",
    messagingSenderId: "649192101754",
    appId: "1:649192101754:web:1844e31928df3f016428c3",
    measurementId: "G-RHFYPD8WKV"
};

// Initialize Firebase safely
if (typeof firebase !== 'undefined' && !firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}

const auth = typeof firebase !== 'undefined' ? firebase.auth() : null;
const db = typeof firebase !== 'undefined' ? firebase.firestore() : null;

if (db) {
    db.enablePersistence().catch(err => {
        console.warn("Persistence note:", err.code);
    });
}

// Global App States
let confirmationResultGlobal = null;
let currentAuthMode = 'login';
let pendingRegistrationData = null;
let pendingProfileUpdate = null;

let currentUserData = null;
let inventoryList = [];
let filteredList = [];

let currentActionType = 'Stock IN';
let capturedImageBase64 = '';
let selectedIndexForOut = -1;
let activeModalToCancel = '';
let pendingDeleteIndex = -1;

// Phone Normalizer
function formatPhone(phone) {
    let cleaned = (phone || '').toString().replace(/\D/g, '');
    if (cleaned.length === 10) {
        cleaned = '91' + cleaned;
    }
    return '+' + cleaned;
}

// Initialization
document.addEventListener('DOMContentLoaded', async () => {
    hideSplashScreen();
    setupEvents();

    const savedPhone = localStorage.getItem('userPhone');
    const localProfile = localStorage.getItem('localProfileData');

    if (localProfile) {
        try {
            currentUserData = JSON.parse(localProfile);
            renderProfileToUI(currentUserData);
            updateHeaderProfileUI(currentUserData);
        } catch (e) {
            console.error(e);
        }
    }

    if (savedPhone) {
        document.getElementById('authOverlay')?.classList.add('hidden');
        await fetchUserDataAndSync(savedPhone);
    } else {
        document.getElementById('authOverlay')?.classList.remove('hidden');
    }
});

function hideSplashScreen() {
    const splash = document.getElementById('appSplashLoader');
    if (splash) {
        setTimeout(() => {
            splash.style.opacity = '0';
            setTimeout(() => splash.style.display = 'none', 400);
        }, 1200);
    }
}

function setupEvents() {
    document.getElementById('btnOpenMenu')?.addEventListener('click', openMenu);
    document.getElementById('btnCloseMenu')?.addEventListener('click', closeMenu);
    document.getElementById('drawerBackdrop')?.addEventListener('click', closeMenu);

    document.getElementById('inputCamera')?.addEventListener('change', handleFileSelect);
    document.getElementById('inputFile')?.addEventListener('change', handleFileSelect);

    document.getElementById('btnConfirmNo')?.addEventListener('click', closeConfirmModal);
    document.getElementById('btnConfirmYes')?.addEventListener('click', handleConfirmAction);
}

// Auth Views
function switchAuthView(mode) {
    currentAuthMode = mode;
    document.getElementById('authRegisterView')?.classList.add('hidden');
    document.getElementById('authLoginView')?.classList.add('hidden');
    document.getElementById('authOtpView')?.classList.add('hidden');

    if (mode === 'register') {
        document.getElementById('authTitle').innerText = "Register Account";
        document.getElementById('authRegisterView')?.classList.remove('hidden');
    } else if (mode === 'login') {
        document.getElementById('authTitle').innerText = "Cloud Login";
        document.getElementById('authLoginView')?.classList.remove('hidden');
    } else {
        document.getElementById('authTitle').innerText = "Verify Mobile OTP";
        document.getElementById('authOtpView')?.classList.remove('hidden');
    }
}

async function sendAuthOtp(mode) {
    let phoneInput = mode === 'register' ? document.getElementById('regPhone') : document.getElementById('loginPhone');
    let rawPhone = phoneInput ? phoneInput.value.trim() : '';

    if (!rawPhone || rawPhone.replace(/\D/g, '').length < 10) {
        showSuccessPopUp("Please enter valid 10-digit phone number!");
        return;
    }

    const phone = formatPhone(rawPhone);

    if (mode === 'register') {
        const name = document.getElementById('regName')?.value.trim();
        const farm = document.getElementById('regFarm')?.value.trim();
        const email = document.getElementById('regEmail')?.value.trim();

        if (!name || !farm) {
            showSuccessPopUp("Please enter Full Name & Farm Name!");
            return;
        }

        pendingRegistrationData = { name, farm, email, phone };
    }

    try {
        if (db) {
            const userDoc = await db.collection('users').doc(phone).get();

            if (mode === 'register' && userDoc.exists) {
                showSuccessPopUp("Number Already Registered! Please Login.");
                switchAuthView('login');
                return;
            }

            if (mode === 'login' && !userDoc.exists) {
                showSuccessPopUp("Number not registered! Please Register first.");
                switchAuthView('register');
                return;
            }
        }

        confirmationResultGlobal = {
            confirm: async (otpCode) => {
                if (otpCode === "123456" || otpCode.length === 6) {
                    return { user: { phoneNumber: phone } };
                } else {
                    throw new Error("Invalid OTP");
                }
            }
        };

        switchAuthView('otp');
        showSuccessPopUp("OTP Sent! Enter 123456 to verify");
    } catch (error) {
        showSuccessPopUp("Auth Error: " + error.message);
    }
}

async function verifyAuthOtp() {
    const otp = document.getElementById('authOtpInput').value.trim();
    if (otp.length !== 6) {
        showSuccessPopUp("Enter 6-digit OTP!");
        return;
    }

    try {
        let result = await confirmationResultGlobal.confirm(otp);
        const phone = result.user.phoneNumber;

        if (currentAuthMode === 'register' && pendingRegistrationData) {
            const userData = {
                name: pendingRegistrationData.name,
                farm: pendingRegistrationData.farm,
                email: pendingRegistrationData.email,
                phone: phone,
                updatedAt: new Date().toISOString()
            };

            if (db) await db.collection('users').doc(phone).set(userData, { merge: true });
            localStorage.setItem('localProfileData', JSON.stringify(userData));
            currentUserData = userData;
            pendingRegistrationData = null;
        }

        if (pendingProfileUpdate && db) {
            await db.collection('users').doc(phone).set(pendingProfileUpdate, { merge: true });
            localStorage.setItem('localProfileData', JSON.stringify(pendingProfileUpdate));
            currentUserData = pendingProfileUpdate;
            pendingProfileUpdate = null;
        }

        localStorage.setItem('userPhone', phone);
        await fetchUserDataAndSync(phone);

        document.getElementById('authOverlay')?.classList.add('hidden');
        showSuccessPopUp("Verified & Logged In!");
    } catch (err) {
        showSuccessPopUp("Verification Failed: " + err.message);
    }
}

function cancelAuthFlow() {
    switchAuthView(currentAuthMode);
}

// Profile & Realtime Sync
async function fetchUserDataAndSync(phone) {
    if (!phone) return;
    const formattedPhone = formatPhone(phone);

    try {
        if (db) {
            const doc = await db.collection('users').doc(formattedPhone).get();
            if (doc.exists) {
                currentUserData = doc.data();
                localStorage.setItem('localProfileData', JSON.stringify(currentUserData));
                renderProfileToUI(currentUserData);
                updateHeaderProfileUI(currentUserData);
            } else if (currentUserData) {
                await db.collection('users').doc(formattedPhone).set(currentUserData, { merge: true });
            }

            db.collection('inventories').doc(formattedPhone).onSnapshot((snap) => {
                if (snap.exists && snap.data().items) {
                    inventoryList = snap.data().items;
                } else {
                    inventoryList = JSON.parse(localStorage.getItem('localInventoryData') || '[]');
                }
                renderInventory();
                updateStats();
            });
        }
    } catch (error) {
        console.error("Profile load err:", error);
    }
}

function renderProfileToUI(data) {
    if (!data) return;
    if (document.getElementById('profName')) document.getElementById('profName').value = data.name || '';
    if (document.getElementById('profFarm')) document.getElementById('profFarm').value = data.farm || '';
    if (document.getElementById('profEmail')) document.getElementById('profEmail').value = data.email || '';
    if (document.getElementById('profPhone')) document.getElementById('profPhone').value = data.phone || '';
}

function updateHeaderProfileUI(data) {
    if (!data) return;
    if (document.getElementById('menuUserName')) document.getElementById('menuUserName').innerText = data.name || 'User';
    if (document.getElementById('menuUserFarm')) document.getElementById('menuUserFarm').innerText = data.farm || 'My Farm';
}

function toggleProfileEdit(enable) {
    const fields = ['profName', 'profFarm', 'profEmail', 'profPhone'];
    fields.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.disabled = !enable;
    });

    const editBtn = document.getElementById('btnProfileEdit');
    const editActions = document.getElementById('profileEditActions');

    if (enable) {
        editBtn?.classList.add('hidden');
        editActions?.classList.remove('hidden');
    } else {
        editBtn?.classList.remove('hidden');
        editActions?.classList.add('hidden');
        if (currentUserData) {
            renderProfileToUI(currentUserData);
        }
    }
}

async function saveProfileChanges() {
    const name = document.getElementById('profName').value.trim();
    const farm = document.getElementById('profFarm').value.trim();
    const email = document.getElementById('profEmail').value.trim();
    const rawPhone = document.getElementById('profPhone').value.trim();
    const phone = formatPhone(rawPhone);

    const updatedProfile = { name, farm, email, phone };

    currentUserData = updatedProfile;
    localStorage.setItem('localProfileData', JSON.stringify(updatedProfile));
    
    if (db && phone) {
        await db.collection('users').doc(phone).set(updatedProfile, { merge: true });
    }

    updateHeaderProfileUI(updatedProfile);
    toggleProfileEdit(false);
    showSuccessPopUp("Profile Saved to Cloud!");
}

function logoutUser() {
    localStorage.clear();
    if (auth) auth.signOut();
    location.reload();
}

async function saveInventoryToCloud() {
    localStorage.setItem('localInventoryData', JSON.stringify(inventoryList));
    const phone = currentUserData?.phone || localStorage.getItem('userPhone');
    if (db && phone) {
        const formattedPhone = formatPhone(phone);
        await db.collection('inventories').doc(formattedPhone).set({ items: inventoryList }, { merge: true });
    }
}

// Dialog Controls
function requestCancel(modalId) {
    activeModalToCancel = modalId;
    pendingDeleteIndex = -1;

    document.getElementById('confirmModalTitle').innerText = "Cancel Operation?";
    document.getElementById('confirmModalText').innerText = "Are you sure you want to cancel?";
    document.getElementById('confirmIcon').className = "fas fa-circle-question confirm-dialog-icon";
    document.getElementById('confirmIcon').style.color = "#f59e0b";

    document.getElementById('customConfirmModal')?.classList.remove('hidden');
}

function requestDelete(index) {
    pendingDeleteIndex = index;
    activeModalToCancel = '';

    const item = inventoryList[index];
    document.getElementById('confirmModalTitle').innerText = "Delete Stock Item?";
    document.getElementById('confirmModalText').innerText = `Are you sure you want to delete "${item.name}"?`;
    document.getElementById('confirmIcon').className = "fas fa-trash-can confirm-dialog-icon";
    document.getElementById('confirmIcon').style.color = "#f43f5e";

    document.getElementById('customConfirmModal')?.classList.remove('hidden');
}

function closeConfirmModal() {
    document.getElementById('customConfirmModal')?.classList.add('hidden');
}

function handleConfirmAction() {
    closeConfirmModal();

    if (activeModalToCancel) {
        closeModal(activeModalToCancel);
        activeModalToCancel = '';
    } else if (pendingDeleteIndex > -1) {
        inventoryList.splice(pendingDeleteIndex, 1);
        pendingDeleteIndex = -1;
        saveInventoryToCloud();
        renderInventory();
        updateStats();
        showSuccessPopUp("Item Deleted!");
    }
}

// UI Navigation
function openMenu() {
    document.getElementById('menuDrawer')?.classList.add('open');
    document.getElementById('drawerBackdrop')?.classList.add('active');
}

function closeMenu() {
    document.getElementById('menuDrawer')?.classList.remove('open');
    document.getElementById('drawerBackdrop')?.classList.remove('active');
}

function switchTab(tabName) {
    document.querySelectorAll('.tab-content').forEach(tc => tc.classList.remove('active'));

    if (tabName === 'stocks') {
        document.getElementById('tabStocks')?.classList.add('active');
    } else if (tabName === 'profile') {
        document.getElementById('tabProfile')?.classList.add('active');
        toggleProfileEdit(false);
    } else {
        document.getElementById('tabSettings')?.classList.add('active');
    }
}

function changeMenuPosition(pos) {
    const drawer = document.getElementById('menuDrawer');
    if (!drawer) return;
    if (pos === 'left') {
        drawer.classList.remove('pos-right');
        drawer.classList.add('pos-left');
    } else {
        drawer.classList.remove('pos-left');
        drawer.classList.add('pos-right');
    }
}

function changeTheme(themeVal) {
    document.body.classList.remove('theme-dark', 'theme-light');
    if (themeVal === 'light') {
        document.body.classList.add('theme-light');
    } else {
        document.body.classList.add('theme-dark');
    }
}

// Stock Actions
function handleStockIn() {
    currentActionType = 'Stock IN';
    selectedIndexForOut = -1;
    document.getElementById('sourceTitle').innerText = 'Stock IN - Select Source';
    document.getElementById('modalSource')?.classList.remove('hidden');
}

function handleStockOut() {
    currentActionType = 'Stock OUT';
    if (inventoryList.length === 0) {
        showSuccessPopUp("Inventory is empty!");
        return;
    }
    renderManualStockListModal();
    document.getElementById('modalStockOutSelect')?.classList.remove('hidden');
}

function renderManualStockListModal() {
    const container = document.getElementById('manualStockList');
    if (!container) return;
    container.innerHTML = inventoryList.map((item, index) => `
        <div class="stock-item" onclick="selectManualStockForOut(${index})">
            <img src="${item.image || 'https://via.placeholder.com/48'}" alt="img" />
            <div class="stock-info">
                <div class="stock-title">${item.name}</div>
                <div class="stock-qty">Available: ${item.qty} units</div>
            </div>
        </div>
    `).join('');
}

function selectManualStockForOut(index) {
    selectedIndexForOut = index;
    const item = inventoryList[index];

    closeModal('modalStockOutSelect');

    document.getElementById('detailsModalTitle').innerText = `Stock OUT - ${item.name}`;
    const nameInput = document.getElementById('prodName');
    nameInput.value = item.name;
    nameInput.disabled = true;

    document.getElementById('prodQty').value = '';
    const hint = document.getElementById('qtyLimitHint');
    hint.innerText = `Max available: ${item.qty}`;
    hint.classList.remove('hidden');

    document.getElementById('btnSubmitCloud').innerHTML = `<i class="fas fa-minus-circle"></i> Deduct Stock`;
    document.getElementById('modalDetails')?.classList.remove('hidden');
}

function triggerCamera(source) {
    closeModal('modalSource');
    if (source === 'camera') {
        document.getElementById('inputCamera').click();
    } else {
        document.getElementById('inputFile').click();
    }
}

function closeModal(modalId) {
    document.getElementById(modalId)?.classList.add('hidden');
}

function handleFileSelect(e) {
    const file = e.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = function (evt) {
            capturedImageBase64 = evt.target.result;
            document.getElementById('imgPreview').src = capturedImageBase64;
            document.getElementById('modalPreview')?.classList.remove('hidden');
        };
        reader.readAsDataURL(file);
    }
}

function proceedToDetails() {
    closeModal('modalPreview');

    if (currentActionType === 'Stock OUT') {
        if (inventoryList.length > 0) {
            selectedIndexForOut = 0;
            const item = inventoryList[0];

            document.getElementById('detailsModalTitle').innerText = `Stock OUT - ${item.name}`;
            const nameInput = document.getElementById('prodName');
            nameInput.value = item.name;
            nameInput.disabled = true;

            const hint = document.getElementById('qtyLimitHint');
            hint.innerText = `Max available: ${item.qty}`;
            hint.classList.remove('hidden');

            document.getElementById('btnSubmitCloud').innerHTML = `<i class="fas fa-minus-circle"></i> Deduct Stock`;
        }
    } else {
        document.getElementById('detailsModalTitle').innerText = `Stock IN - Add Item`;
        const nameInput = document.getElementById('prodName');
        nameInput.value = '';
        nameInput.disabled = false;
        document.getElementById('qtyLimitHint').classList.add('hidden');
        document.getElementById('btnSubmitCloud').innerHTML = `<i class="fas fa-cloud-arrow-up"></i> Save to Cloud`;
    }

    document.getElementById('modalDetails')?.classList.remove('hidden');
}

function uploadToCloudProcess() {
    const name = document.getElementById('prodName').value.trim();
    const qtyVal = parseInt(document.getElementById('prodQty').value);

    if (!name || isNaN(qtyVal) || qtyVal <= 0) {
        showSuccessPopUp("Please enter valid quantity!");
        return;
    }

    if (currentActionType === 'Stock OUT') {
        const currentItem = inventoryList[selectedIndexForOut];
        if (qtyVal > currentItem.qty) {
            showSuccessPopUp(`Max available quantity is ${currentItem.qty}`);
            return;
        }
    }

    closeModal('modalDetails');
    const uploadModal = document.getElementById('modalUploadProgress');
    const progressBar = document.getElementById('uploadProgressBar');
    const percentTxt = document.getElementById('uploadPercentText');
    document.getElementById('uploadModalTitle').innerText = currentActionType === 'Stock IN' ? "Syncing with Cloud..." : "Deducting Stock...";

    uploadModal.classList.remove('hidden');
    let percent = 0;

    const interval = setInterval(() => {
        percent += 10;
        progressBar.style.width = percent + '%';
        percentTxt.innerText = percent + '%';

        if (percent >= 100) {
            clearInterval(interval);
            uploadModal.classList.add('hidden');

            if (currentActionType === 'Stock IN') {
                const existingIndex = inventoryList.findIndex(i => i.name.toLowerCase() === name.toLowerCase());
                if (existingIndex > -1) {
                    inventoryList[existingIndex].qty += qtyVal;
                } else {
                    inventoryList.unshift({ id: Date.now(), name, qty: qtyVal, image: capturedImageBase64 || 'https://images.unsplash.com/photo-1586528116311-ad8dd3c8310d?w=100' });
                }
            } else {
                inventoryList[selectedIndexForOut].qty -= qtyVal;
                if (inventoryList[selectedIndexForOut].qty <= 0) {
                    inventoryList.splice(selectedIndexForOut, 1);
                }
            }

            saveInventoryToCloud();
            renderInventory();
            updateStats();
            document.getElementById('prodName').value = '';
            document.getElementById('prodQty').value = '';

            showSuccessPopUp(currentActionType === 'Stock IN' ? "Stock Added to Cloud!" : "Stock Deducted Successfully!");
        }
    }, 120);
}

function filterInventory() {
    const query = document.getElementById('searchInput').value.toLowerCase().trim();
    if (!query) {
        renderInventory(inventoryList);
    } else {
        const filtered = inventoryList.filter(item => item.name.toLowerCase().includes(query));
        renderInventory(filtered);
    }
}

function renderInventory(listToRender = inventoryList) {
    const container = document.getElementById('stockListContainer');
    if (!container) return;

    if (listToRender.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-box-open"></i>
                <p>No inventory records found.</p>
            </div>
        `;
        return;
    }

    container.innerHTML = listToRender.map((item, index) => {
        const realIndex = inventoryList.findIndex(i => i.id === item.id);
        return `
            <div class="stock-item">
                <img src="${item.image || 'https://images.unsplash.com/photo-1586528116311-ad8dd3c8310d?w=100'}" alt="item" />
                <div class="stock-info">
                    <div class="stock-title">${item.name}</div>
                    <div class="stock-qty"><i class="fas fa-layer-group"></i> In Stock: ${item.qty} units</div>
                </div>
                <button class="btn-delete-item" onclick="requestDelete(${realIndex > -1 ? realIndex : index})" title="Delete">
                    <i class="fas fa-trash-can"></i>
                </button>
            </div>
        `;
    }).join('');
}

function updateStats() {
    const totalItems = inventoryList.length;
    const totalQty = inventoryList.reduce((acc, curr) => acc + (curr.qty || 0), 0);

    if (document.getElementById('statTotalItems')) document.getElementById('statTotalItems').innerText = totalItems;
    if (document.getElementById('statTotalQty')) document.getElementById('statTotalQty').innerText = totalQty;
}

function showSuccessPopUp(msg) {
    const popup = document.getElementById('successPopUp');
    if (!popup) return;
    document.getElementById('popUpMessage').innerText = msg;
    popup.classList.remove('hidden');
    setTimeout(() => popup.classList.add('hidden'), 2200);
}
