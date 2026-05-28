// Small generic functions used along the whole repository

// Compare if two objects are identical key by key and value by value
// Note that this is a shallow comparator
// If the object have objects or arrays inside the result may be unexpected
const areObjectsIdentical = (object1, object2) => {
    // Iterate keys and values to in the first object
    for (const [key, value] of Object.entries(object1)) {
        if (!key in object2) return false;
        if (object1[key] !== value) return false;
    }
    // Iterate keys and values to in the second object
    for (const [key, value] of Object.entries(object2)) {
        if (!key in object1) return false;
        if (object1[key] !== value) return false;
    }
    // If no differentce was found then object must be identical
    return true;
}

module.exports = {
    areObjectsIdentical
};