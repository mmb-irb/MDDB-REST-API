#include <iostream>
#include <fstream>
#include <cstdlib>
#include "chemfiles.hpp"

// Given a trajectory in 'bin' format, convert the trajectory to a specified format and then output the result
// The input trajectory is meant to be passed throw a pipe

// This script relies in a fork of chemfiles to work
// The fork: https://github.com/d-beltran/chemfiles
// Original repository: https://github.com/chemfiles/chemfiles

// This script must be compiled like this
//      g++ -c chemfiles_bin_converter.cpp
//      g++ -o chemfiles_bin_converter chemfiles_bin_converter.o -L <chemfiles fork lib> -lchemfiles

// This script must be called like this:
//      ./chemfiles_bin_converter <number of atoms> <number of frames> <output format>

int main(int argc, char** argv) {

    // Check the number of arguments to be right
    if (argc != 4) {
        std::string self_call = static_cast<std::string>(argv[0]);
        std::cerr << "This script must be called like this:" << std::endl;
        std::cerr << self_call + " <number of atoms> <number of frames> <output format>" << std::endl;
        return 1;
    }

    // Parse the arguments
    size_t n_atoms = static_cast<size_t>(atoll(argv[1]));
    size_t n_steps = static_cast<size_t>(atoll(argv[2]));
    std::string output_format = static_cast<std::string>(argv[3]);

    // Set the input trajectory
    const std::string& input_format = "BIN";
    chemfiles::Trajectory trajectory("<stdin>", 'r', input_format);

    // Now we need to specify the number of atoms in the trajectory, since this can not be guessed
    trajectory.set_natoms(n_atoms);

    // Write the trajectory to the output format
    auto output_trajectory = chemfiles::Trajectory("<stdout>", 'w', output_format);
    // Prevent the number of frames to be streamed
    // This is necessary for some formats (e.g. nc)
    // This is unnecessary for some formats (e.g. xtc, trr)
    if (output_format == "Amber NetCDF") {
        output_trajectory.set_nsteps(n_steps);
    }

    for (int i = 0; i < n_steps; i++) {
        // Read a frame from the original trajectory
        auto frame = trajectory.read();
        // Write it to the output trajectory, which will convert it to the output format
        output_trajectory.write(frame);
    }

}