// Set a class to handle version comparisions
class Version {
    constructor (versionString) {
        // If there is no version then consider it the 0.0.0
        if (versionString === undefined) versionString = '0.0.0';
        // Get the major, minor and patch versions
        const splits = versionString.split('.');
        this.major = splits[0] && +splits[0];
        if (this.major > 999)
            throw new Error('Major version is greater than 999 and this is not allowed');
        this.minor = splits[1] && +splits[1];
        if (this.minor > 999)
            throw new Error('Minor version is greater than 999 and this is not allowed');
        this.patch = splits[2] && +splits[2];
        if (this.patch > 999)
            throw new Error('Patch version is greater than 999 and this is not allowed');
    }

    // Get the version back in string format
    // This has also an effect in the console-log display
    toString () {
        let string = this.major.toString();
        if (this.minor === undefined) return string;
        string += '.' + this.minor.toString();
        if (this.patch === undefined) return string;
        string += '.' + this.patch.toString();
        return string;
    }

    // Check if two versions are equal
    equals (other) {
        // If this is a string instead of a version the parse it
        if (typeof other === 'string') return this.equals(new Version(other));
        // Check if versions are equal for all major, minor and patch versions
        // If other version has not explicit patch or minor version then they are not compared
        if (other.major !== this.major) return false;
        if (other.minor !== undefined && other.minor !== this.minor) return false;
        if (other.patch !== undefined && other.patch !== this.patch) return false;
        return true;
    }

    // Check if this version is greater than the other version    
    greaterThan (other) {
        // If this is a string instead of a version the parse it
        if (typeof other === 'string') return this.greaterThan(new Version(other));
        // Check if versions are greater for all major, minor and patch versions
        // If other version has not explicit patch or minor version then they are not compared
        if (other.major !== undefined && other.major > this.major) return false;
        if (other.minor !== undefined && other.minor > this.minor) return false;
        if (other.patch !== undefined && other.patch > this.patch) return false;
        return true;
    }
}

// This allows version comparision in the classic JS notation
// e.g. version1 >= version2
Version.prototype.valueOf = function() {
    // Make sure the value will make version values coherent
    // Note that the every version value is limited to 999 to make this function safe
    return this.major * 1000000 + (this.minor || 0) * 1000 + (this.patch || 0);
};

module.exports = Version;