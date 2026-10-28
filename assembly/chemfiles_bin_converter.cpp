#include <iostream>
#include <fstream>
#include <cstdlib>
#include <cstdio>
#include "chemfiles.hpp"

// Given a trajectory in 'bin' format, convert the trajectory to a specified format and then output the result
// The input trajectory is meant to be passed throw a pipe
// Optionally, the simulation box may be passed throw a second pipe in the file descriptor 3
// The box is also in 'bin' format: 3 vectors of 3 float32 coordinates (Å) per frame

// This script relies in a fork of chemfiles to work
// The fork: https://github.com/d-beltran/chemfiles
// Original repository: https://github.com/chemfiles/chemfiles

// This script must be compiled like this
//      g++ -c chemfiles_bin_converter.cpp
//      g++ -o chemfiles_bin_converter chemfiles_bin_converter.o -L <chemfiles fork lib> -lchemfiles

// This script must be called like this:
//      ./chemfiles_bin_converter <number of atoms> <number of frames> <output format> [box]
// The 'box' flag means the box is to be read from the file descriptor 3

// File descriptor where the box is read from
const int BOX_FILE_DESCRIPTOR = 3;
// Number of float32 values in the box of a single frame
const size_t BOX_VALUES = 9;

int main(int argc, char** argv) {

    // Check the number of arguments to be right
    bool wrong_box_flag = argc == 5 && static_cast<std::string>(argv[4]) != "box";
    if ((argc != 4 && argc != 5) || wrong_box_flag) {
        std::string self_call = static_cast<std::string>(argv[0]);
        std::cerr << "This script must be called like this:" << std::endl;
        std::cerr << self_call + " <number of atoms> <number of frames> <output format> [box]" << std::endl;
        return 1;
    }

    // Parse the arguments
    size_t n_atoms = static_cast<size_t>(atoll(argv[1]));
    size_t n_steps = static_cast<size_t>(atoll(argv[2]));
    std::string output_format = static_cast<std::string>(argv[3]);
    bool with_box = argc == 5;

    // Only XTC and TRR store the whole box matrix, so the box orientation is kept (e.g. a box rotated after a fit)
    // Other formats (e.g. nc, dcd) store only the box lengths and angles, which would be misleading for a rotated box
    if (with_box && output_format != "XTC" && output_format != "TRR") {
        std::cerr << "The box is only supported for XTC and TRR formats, not for " << output_format << std::endl;
        return 1;
    }

    // Open the box input, if any
    FILE* box_input = nullptr;
    if (with_box) {
        box_input = fdopen(BOX_FILE_DESCRIPTOR, "rb");
        if (box_input == nullptr) {
            std::cerr << "Failed to open the box input in the file descriptor " << BOX_FILE_DESCRIPTOR << std::endl;
            return 1;
        }
    }

    // Set the input trajectory
    const std::string& input_format = "BIN";
    chemfiles::Trajectory trajectory("<stdin>", 'r', input_format);

    // Now we need to specify the number of atoms in the trajectory, since this can not be guessed
    trajectory.set_natoms(n_atoms);

    // Write the trajectory to the output format
    auto output_trajectory = chemfiles::Trajectory("<stdout>", 'w', output_format);
    // Prevent the number of frames to be streamed
    // This is necessary for formats storing it in the header (e.g. nc, dcd)
    // This is unnecessary for some formats (e.g. xtc, trr)
    if (output_format == "Amber NetCDF" || output_format == "DCD") {
        output_trajectory.set_nsteps(n_steps);
    }

    for (int i = 0; i < n_steps; i++) {
        // Read a frame from the original trajectory
        auto frame = trajectory.read();
        // Set the box of the current frame, if any
        if (with_box) {
            float box[BOX_VALUES];
            if (fread(box, sizeof(float), BOX_VALUES, box_input) != BOX_VALUES) {
                std::cerr << "Missing box data for frame " << i << std::endl;
                return 1;
            }
            // Every row in the matrix is a box vector
            frame.set_cell(chemfiles::UnitCell(chemfiles::Matrix3D(
                box[0], box[1], box[2],
                box[3], box[4], box[5],
                box[6], box[7], box[8]
            )));
        }
        // Write it to the output trajectory, which will convert it to the output format
        output_trajectory.write(frame);
    }

}