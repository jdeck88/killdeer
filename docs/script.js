let editedRows = new Set();

async function login() {
    const username = document.getElementById("username").value;
    const password = document.getElementById("password").value;

    try {
        const response = await fetch("https://biscicol.org/dff/v2/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username, password })
        });

        const data = await response.json();
        if (response.ok && data.token) {
            localStorage.setItem("token", data.token);
            loadData();
        } else {
            alert("Login failed!");
        }
    } catch (error) {
        alert("Network error! ❌ Unable to reach server.");
    }
}

async function loadData() {
    const token = localStorage.getItem("token");
    if (!token) {
        alert("Please log in first.");
        return;
    }

    try {
        const response = await fetch("https://biscicol.org/dff/v2/data", {
            method: "GET",
            headers: { "Authorization": `Bearer ${token}` }
        });

        const data = await response.json();
        let tableBody = document.getElementById("tableBody");
        tableBody.innerHTML = "";
        editedRows.clear();
        document.getElementById("applyChanges").disabled = true;

        // Extract unique categories
        let categories = new Set();
        data.forEach(row => {
            categories.add(row.category);
            tableBody.innerHTML += `
            <tr data-id="${row.id}" data-category="${row.category}">
                <td>${row.category}</td>        
                <td>${row.productName}</td>
                <td>${row.packageName}</td>
                <td><textarea class="editable-textarea" oninput="markEdited(this); autoResize(this)">${row.description || ''}</textarea></td>      
                <td><div class="toggle-switch ${row.visible ? 'active' : ''}" onclick="toggleSwitch(this)"></div></td>
                <td><div class="toggle-switch ${row.track_inventory ? 'active' : ''}" onclick="toggleSwitch(this)"></div></td>
                <td><input type="number" class="stock-input" value="${row.stock_inventory}" oninput="markEdited(this)"></td>
                <td></td>
            </tr>`;
        });

        // Populate the category filter dropdown
        let categoryFilter = document.getElementById("categoryFilter");
        categoryFilter.innerHTML = `<option value="all">All Categories</option>`;
        categories.forEach(category => {
            categoryFilter.innerHTML += `<option value="${category}">${category}</option>`;
        });

        // Apply sorting functionality after data loads
        applySorting();
    } catch (error) {
        alert("Session expired. Please log in again.");
    }
}

function autoResize(textarea) {
    textarea.style.height = "auto"; // Reset height to recalculate
    textarea.style.height = (textarea.scrollHeight) + "px"; // Set new height
}

function filterCategory() {
    let selectedCategory = document.getElementById("categoryFilter").value;
    let rows = document.querySelectorAll("#tableBody tr");

    rows.forEach(row => {
        let rowCategory = row.getAttribute("data-category");
        if (selectedCategory === "all" || rowCategory === selectedCategory) {
            row.style.display = "";
        } else {
            row.style.display = "none";
        }
    });
}

// Sorting Functionality (Re-applied after data loads)
function applySorting() {
    $("th").not(":last-child").off("click").each(function (index) {
        $(this).css("cursor", "pointer").on("click", function () {
            let table = $(this).closest("table");
            let rows = table.find("tbody tr").toArray();
            let ascending = $(this).hasClass("asc");

            // Remove sort indicators from all headers
            $("th").removeClass("asc desc");

            // Toggle sorting order
            $(this).toggleClass("asc", !ascending);
            $(this).toggleClass("desc", ascending);

            // Sort function
            rows.sort((rowA, rowB) => {
                let cellA = $(rowA).children("td").eq(index).text().trim();
                let cellB = $(rowB).children("td").eq(index).text().trim();

                // Convert to numbers if possible
                let numA = parseFloat(cellA);
                let numB = parseFloat(cellB);
                if (!isNaN(numA) && !isNaN(numB)) {
                    return ascending ? numB - numA : numA - numB;
                }

                return ascending ? cellB.localeCompare(cellA) : cellA.localeCompare(cellB);
            });

            // Reorder the table rows
            $.each(rows, function (_, row) {
                table.children("tbody").append(row);
            });
        });
    });
}

function toggleSwitch(element) {
    element.classList.toggle("active");
    markEdited(element);
}

function markEdited(element) {
    let row = element.closest("tr");
    let id = row.getAttribute("data-id");

    // Get values from row
    //let productName = row.querySelector(".editable-input"); // Select product name input
    let description = row.querySelector(".editable-textarea"); // Select description textarea

    let visible = row.querySelectorAll(".toggle-switch")[0].classList.contains("active");
    let track_inventory = row.querySelectorAll(".toggle-switch")[1].classList.contains("active");
    let stock_inventory = parseInt(row.querySelector(".stock-input").value) || 0;

    // ✅ Condition Check
    if (track_inventory && visible && stock_inventory === 0) {
        alert("⚠️ If there are 0 items and 'Track Inventory' is ON, you must set 'Visible' to OFF.");
        // **Immediately revert the change**
        if (element.classList.contains("toggle-switch")) {
            element.classList.toggle("active"); // Toggle switch back
        } else {
            element.value = "1"; // Reset stock_inventory input to 1
        }
        return;
    }

    // ✅ Mark row as edited
    editedRows.add(id);
    row.classList.add("edited");
    document.getElementById("applyChanges").disabled = false;
}

async function applyChanges() {
    if (editedRows.size === 0) return;

    const token = localStorage.getItem("token");
    if (!token) {
        alert("Please log in first.");
        return;
    }

    let updates = [];
    editedRows.forEach(id => {
        let row = document.querySelector(`tr[data-id="${id}"]`);
        let productNameField = row.querySelector(".editable-input");
        let descriptionField = row.querySelector(".editable-textarea");

        let data = {
            productName: productNameField ? productNameField.value : "",
            description: descriptionField ? descriptionField.value : "",
            visible: row.querySelectorAll(".toggle-switch")[0].classList.contains("active"),
            track_inventory: row.querySelectorAll(".toggle-switch")[1].classList.contains("active"),
            stock_inventory: row.querySelector(".stock-input").value
        };
        updates.push({ id, data });
    });

    try {
        // Execute all update requests
        const responses = await Promise.all(updates.map(async ({ id, data }) => {
            const response = await fetch(`https://biscicol.org/dff/v2/update/${id}`, {
                method: "PUT",
                headers: {
                    "Authorization": `Bearer ${token}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(data)
            });

            // Parse the response JSON
            const result = await response.json();

            // Return the response in a structured format
            return { id, result };
        }));

        // Format responses for display
        const alertMessage = responses.map(({ id, result }) =>
            `ID: ${id}\nResponse: ${JSON.stringify(result, null, 2)}`
        ).join("\n\n");

        // Show in alert
        alert(`Responses:\n${alertMessage}`);

        // Clear edited rows and refresh data
        editedRows.clear();
        document.getElementById("applyChanges").disabled = true;
        loadData();
    } catch (error) {
        alert("Failed to save changes.");
        console.error("Error updating items:", error);
    }

}

function logout() {
    localStorage.removeItem("token");
    document.getElementById("tableBody").innerHTML = "";
    alert("Logged out!");
}

window.onload = function () {
    if (localStorage.getItem("token")) {
        loadData();
    }
};