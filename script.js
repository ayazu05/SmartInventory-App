// ==========================================
// QUANTITY MODIFY FUNCTIONALITY (ADDED)
// ==========================================

// 1. Quantity Update Modal Open karne ke liye
function openModifyQtyModal(itemId, itemName, currentQty) {
    window.selectedModifyItemId = itemId;
    
    const nameEl = document.getElementById('modifyItemNameDisplay');
    const qtyInput = document.getElementById('modifyQtyVal');
    const modal = document.getElementById('modifyQtyModal');
    
    if (nameEl) nameEl.innerText = itemName;
    if (qtyInput) qtyInput.value = currentQty;
    if (modal) modal.classList.remove('hidden');
}

// 2. Modal Close karne ke liye
function closeModifyQtyModal() {
    const modal = document.getElementById('modifyQtyModal');
    if (modal) modal.classList.add('hidden');
    window.selectedModifyItemId = null;
}

// 3. Plus/Minus Buttons ke liye
function stepModifyQty(change) {
    const qtyInput = document.getElementById('modifyQtyVal');
    if (qtyInput) {
        let currentVal = parseInt(qtyInput.value) || 0;
        currentVal += change;
        if (currentVal < 0) currentVal = 0;
        qtyInput.value = currentVal;
    }
}

// 4. Firebase Firestore me Update Save karne ke liye
function saveModifiedQuantity() {
    const qtyInput = document.getElementById('modifyQtyVal');
    const newQty = parseInt(qtyInput.value) || 0;
    const itemId = window.selectedModifyItemId;

    if (!itemId) {
        closeModifyQtyModal();
        return;
    }

    // Firebase Auth user check
    const user = firebase.auth().currentUser;
    if (!user) {
        alert("User not authenticated!");
        return;
    }

    // Firestore Update
    db.collection('users').doc(user.uid).collection('stocks').doc(itemId).update({
        quantity: newQty,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    })
    .then(() => {
        if (typeof showToast === 'function') {
            showToast("Quantity updated successfully!");
        } else if (typeof showSuccessPopUp === 'function') {
            showSuccessPopUp("Quantity updated successfully!");
        }
        closeModifyQtyModal();
    })
    .catch((error) => {
        console.error("Error updating quantity: ", error);
        alert("Failed to update quantity: " + error.message);
    });
}
