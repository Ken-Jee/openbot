### Fixed

- An hourly routine can now run between two times that cross midnight, for example from 8:00 PM to 10:00 AM. Before, the routine editor showed "The end time must be after the start time." and did not save the routine. A run after midnight uses the days of its own date: with Monday to Friday, a run at 2:00 AM on Saturday does not occur.
