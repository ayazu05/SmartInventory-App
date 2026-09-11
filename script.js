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

// Initialize Firebase
if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
    firebase.analytics();
}

const auth = firebase.auth();
const db = firebase.firestore();

// Global App States
let confirmationResultGlobal = null;
let currentAuthMode = 'login';
let pendingProfileUpdate = null;

let currentUserData = null;
let inventoryList = [];

let currentActionType = 'Stock IN';
let capturedImageBase64 = '';
let selectedIndexForOut = -1;
let activeModalToCancel = '';
let pendingDeleteIndex = -1;

// Application Initialization
document.addEventListener('DOMContentLoaded', () => {
    hideSplashScreen();
    initAiModelDownload();
    setupEvents();
    initRecaptcha();

    auth.onAuthStateChanged(user => {
        if (user) {
            localStorage.setItem('userPhone', user.phoneNumber);
            fetchUserDataAndSync(user.phoneNumber);
            document.getElementById('authOverlay')?.classList.add('hidden');
        } else {
            const savedPhone = localStorage.getItem('userPhone');
            if (savedPhone) {
                fetchUserDataAndSync(savedPhone);
                document.getElementById('authOverlay')?.classList.add('hidden');
            } else {
                document.getElementById('authOverlay')?.classList.remove('hidden');
            }
        }
    });
});

function initRecaptcha() {
    if (document.getElementById('recaptcha-container')) {
        window.recaptchaVerifier = new firebase.auth.RecaptchaVerifier('recaptcha-container', {
            'size': 'invisible'
        });
    }
}

function hideSplashScreen() {
    const splash = document.getElementById('appSplashLoader');
    if (splash) {
        setTimeout(() => {
            splash.style.opacity = '0';
            setTimeout(() => splash.style.display = 'none', 400);
        }, 2000);
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

// Authentication & Dynamic OTP Flow
function switchAuthView(mode) {
    currentAuthMode = mode;
    document.getElementById('authRegisterView')?.classList.add('hidden');
    document.getElementById('authLoginView')?.classList.add('hidden');
    document.getElementById('authOtpView')?.classList.add('hidden');

    if (mode === 'register') {
        document.getElementById('authTitle').innerText = "Register Account";
        document.getElementById('authRegisterView')?.classList.remove('hidden');
    } else if (mode === 'login') {
        document.getElementById('authTitle').innerText = "Login to Cloud";
        document.getElementById('authLoginView')?.classList.remove('hidden');
    } else {
        document.getElementById('authTitle').innerText = "Enter OTP";
        document.getElementById('authOtpView')?.classList.remove('hidden');
    }
}

async function sendAuthOtp(mode) {
    let phoneInput = mode === 'register' ? document.getElementById('regPhone') : document.getElementById('loginPhone');
    let phone = phoneInput ? phoneInput.value.trim() : '';

    if (!phone || phone.length < 10) {
        showSuccessPopUp("Enter valid mobile number!");
        return;
    }

    if (!phone.startsWith('+')) {
        phone = '+91' + phone.replace(/^0+/, '');
    }

    try {
        const userDoc = await db.collection('users').doc(phone).get();

        if (mode === 'register' && userDoc.exists) {
            showSuccessPopUp("Number Already Registered! Please Login.");
            return;
        }

        if (mode === 'login' && !userDoc.exists) {
            showSuccessPopUp("Number not registered! Please Register first.");
            return;
        }

        const confirmationResult = await auth.signInWithPhoneNumber(phone, window.recaptchaVerifier);
        confirmationResultGlobal = confirmationResult;
        switchAuthView('otp');
        showSuccessPopUp("OTP Sent to Mobile!");
    } catch (error) {
        showSuccessPopUp("OTP Error: " + error.message);
    }
}

function verifyAuthOtp() {
    const otp = document.getElementById('authOtpInput').value.trim();
    if (otp.length !== 6) {
        showSuccessPopUp("Enter 6-digit OTP!");
        return;
    }

    confirmationResultGlobal.confirm(otp).then(async (result) => {
        const phone = result.user.phoneNumber;

        if (currentAuthMode === 'register') {
            const userData = {
                name: document.getElementById('regName').value.trim() || 'User',
                email: document.getElementById('regEmail').value.trim() || '',
                farm: document.getElementById('regFarm').value.trim() || 'My Farm',
                phone: phone,
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            };
            await db.collection('users').doc(phone).set(userData, { merge: true });
        }

        if (pendingProfileUpdate) {
            await db.collection('users').doc(phone).update(pendingProfileUpdate);
            pendingProfileUpdate = null;
        }

        localStorage.setItem('userPhone', phone);
        await fetchUserDataAndSync(phone);
        
        document.getElementById('authOverlay')?.classList.add('hidden');
        showSuccessPopUp("Verified & Logged In!");
    }).catch(() => {
        showSuccessPopUp("Invalid OTP!");
    });
}

function cancelAuthFlow() {
    switchAuthView(currentAuthMode);
}

// User Profile Management & Permanent Cloud Data Sync
async function fetchUserDataAndSync(phone) {
    if (!phone) return;

    try {
        const doc = await db.collection('users').doc(phone).get();
        if (doc.exists) {
            currentUserData = doc.data();

            if (document.getElementById('profName')) document.getElementById('profName').value = currentUserData.name || '';
            if (document.getElementById('profFarm')) document.getElementById('profFarm').value = currentUserData.farm || '';
            if (document.getElementById('profEmail')) document.getElementById('profEmail').value = currentUserData.email || '';
            if (document.getElementById('profPhone')) document.getElementById('profPhone').value = currentUserData.phone || phone;

            db.collection('inventories').doc(phone).onSnapshot((snap) => {
                if (snap.exists && snap.data().items) {
                    inventoryList = snap.data().items;
                } else {
                    inventoryList = [];
                }
                renderInventory();
            });
        }
    } catch (error) {
        console.error("Error loading profile:", error);
    }
}

// Profile Edit Mode (Toggle, Save & Exit)
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
            document.getElementById('profName').value = currentUserData.name || '';
            document.getElementById('profFarm').value = currentUserData.farm || '';
            document.getElementById('profEmail').value = currentUserData.email || '';
            document.getElementById('profPhone').value = currentUserData.phone || '';
        }
    }
}

async function saveProfileChanges() {
    if (!currentUserData) return;

    const newEmail = document.getElementById('profEmail').value.trim();
    const newPhone = document.getElementById('profPhone').value.trim();

    if (newEmail !== currentUserData.email || newPhone !== currentUserData.phone) {
        pendingProfileUpdate = {
            name: document.getElementById('profName').value.trim(),
            farm: document.getElementById('profFarm').value.trim(),
            email: newEmail,
            phone: newPhone
        };
        switchAuthView('login');
        document.getElementById('authOverlay')?.classList.remove('hidden');
        showSuccessPopUp("Verify OTP for Email/Phone update!");
        return;
    }

    await db.collection('users').doc(currentUserData.phone).update({
        name: document.getElementById('profName').value.trim(),
        farm: document.getElementById('profFarm').value.trim()
    });

    currentUserData.name = document.getElementById('profName').value.trim();
    currentUserData.farm = document.getElementById('profFarm').value.trim();

    toggleProfileEdit(false);
    showSuccessPopUp("Profile Saved Successfully!");
}

function logoutUser() {
    localStorage.removeItem('userPhone');
    auth.signOut().then(() => {
        location.reload();
    });
}

async function saveInventoryToCloud() {
    const phone = currentUserData?.phone || localStorage.getItem('userPhone');
    if (phone) {
        await db.collection('inventories').doc(phone).set({ items: inventoryList });
    }
}

// Custom Dialog UI Handlers
function requestCancel(modalId) {
    activeModalToCancel = modalId;
    pendingDeleteIndex = -1;

    document.getElementById('confirmModalTitle').innerText = "Want to Cancel?";
    document.getElementById('confirmModalText').innerText = "Do you want to cancel this operation?";
    document.getElementById('confirmIcon').className = "fas fa-circle-question confirm-dialog-icon";
    document.getElementById('confirmIcon').style.color = "#f59e0b";
    
    document.getElementById('customConfirmModal')?.classList.remove('hidden');
}

function requestDelete(index) {
    pendingDeleteIndex = index;
    activeModalToCancel = '';

    const item = inventoryList[index];
    document.getElementById('confirmModalTitle').innerText = "Want to Delete?";
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
        showSuccessPopUp("Item Deleted Successfully!");
    }
}

// Menu & Navigation Controls
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

// Settings Controls
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

// Stock Action Handlers
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
                <div class="stock-qty">Available: ${item.qty}</div>
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
        document.getElementById('btnSubmitCloud').innerHTML = `<i class="fas fa-cloud-arrow-up"></i> Upload`;
    }

    document.getElementById('modalDetails')?.classList.remove('hidden');
}

function uploadToCloudProcess() {
    const name = document.getElementById('prodName').value.trim();
    const qtyVal = parseInt(document.getElementById('prodQty').value);

    if (!name || isNaN(qtyVal) || qtyVal <= 0) {
        showSuccessPopUp("Enter valid Quantity!");
        return;
    }

    if (currentActionType === 'Stock OUT') {
        const currentItem = inventoryList[selectedIndexForOut];
        if (qtyVal > currentItem.qty) {
            showSuccessPopUp(`Max available: ${currentItem.qty}`);
            return;
        }
    }

    closeModal('modalDetails');
    const uploadModal = document.getElementById('modalUploadProgress');
    const progressBar = document.getElementById('uploadProgressBar');
    const percentTxt = document.getElementById('uploadPercentText');
    document.getElementById('uploadModalTitle').innerText = currentActionType === 'Stock IN' ? "Uploading to Cloud..." : "Deducting Stock...";

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
                    inventoryList.unshift({ id: Date.now(), name, qty: qtyVal, image: capturedImageBase64 || 'https://via.placeholder.com/48' });
                }
            } else {
                inventoryList[selectedIndexForOut].qty -= qtyVal;
                if (inventoryList[selectedIndexForOut].qty <= 0) {
                    inventoryList.splice(selectedIndexForOut, 1);
                }
            }

            saveInventoryToCloud();
            renderInventory();
            document.getElementById('prodName').value = '';
            document.getElementById('prodQty').value = '';

            showSuccessPopUp(currentActionType === 'Stock IN' ? "Stock Added Successfully!" : "Stock Deducted Successfully!");
        }
    }, 150);
}

function renderInventory() {
    const container = document.getElementById('stockListContainer');
    if (!container) return;
    if (inventoryList.length === 0) {
        container.innerHTML = '<p class="empty-msg">No stock items available.</p>';
        return;
    }

    container.innerHTML = inventoryList.map((item, index) => `
        <div class="stock-item">
            <img src="${item.image || 'https://via.placeholder.com/48'}" alt="img" />
            <div class="stock-info">
                <div class="stock-title">${item.name}</div>
                <div class="stock-qty">In Stock: ${item.qty} units</div>
            </div>
            <button class="btn-delete-item" onclick="requestDelete(${index})">
                <i class="fas fa-trash-can"></i>
            </button>
        </div>
    `).join('');
}

function showSuccessPopUp(msg) {
    const popup = document.getElementById('successPopUp');
    if (!popup) return;
    document.getElementById('popUpMessage').innerText = msg;
    popup.classList.remove('hidden');
    setTimeout(() => popup.classList.add('hidden'), 2000);
}

function initAiModelDownload() {
    const aiContainer = document.getElementById('aiDownloadContainer');
    if (!aiContainer) return;
    aiContainer.classList.remove('hidden');

    let percent = 0;
    const interval = setInterval(() => {
        percent += 5;
        if (percent >= 100) {
            clearInterval(interval);
            setTimeout(() => aiContainer.classList.add('hidden'), 800);
        }
    }, 120);
}