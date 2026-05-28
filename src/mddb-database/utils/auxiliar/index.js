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

// Set a function to build value getters with specific nesting paths
// Each nested step is separated by a dot
// e.g. 'metadata.INCHIKEYS' -> { metadata: { INCHIKEYS: <target value> } } 
const getValueGetter = path => {
    if (!path) throw new Error('Value getter has no path');
    // Split the path in its nested steps
    const steps = path.split('.');
    // Build the getter function
    const valueGetter = object => {
        let lastObject = object;
        for (const step of steps) {
            lastObject = lastObject[step]
            if (lastObject === undefined) return;
        }
        return lastObject;
    }
    return valueGetter;
};

module.exports = {
    areObjectsIdentical,
    getValueGetter,
};