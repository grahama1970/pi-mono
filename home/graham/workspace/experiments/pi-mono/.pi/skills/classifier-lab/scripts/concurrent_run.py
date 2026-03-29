def phase_data_validation(data_dir, modality):
    """
    Validates the dataset by checking its structure and content.
    
    Args:
        data_dir (str): Path to the dataset directory or HuggingFace dataset name.
        modality (str): Modality of the data (e.g., 'text', 'image').
    
    Returns:
        dict: Audit dictionary containing dataset statistics.
    """
    import os
    from datasets import load_dataset
    from collections import Counter

    if os.path.exists(data_dir):
        # Existing logic for local dataset validation
        # (Assuming this part remains unchanged)
        # ...
        pass
    else:
        # Handle HuggingFace dataset names
        try:
            # Load the dataset
            ds = load_dataset(data_dir, split='train[:100]')
            
            # Get class names
            class_names = ds.features['label'].names
            
            # Count samples per class
            class_counts = Counter(ds['label'])
            
            # Calculate minimum samples per class
            min_per_class = min(class_counts.values())
            
            # Check if the dataset is balanced
            balanced = len(set(class_counts.values())) == 1
            
            # Prepare the audit dictionary
            audit_dict = {
                'n_classes': len(class_names),
                'total_samples': len(ds),
                'class_counts': class_counts,
                'min_per_class': min_per_class,
                'balanced': balanced
            }
            
            return audit_dict
        except Exception as e:
            # Handle any errors that occur during dataset loading
            print(f"Error loading dataset {data_dir}: {e}")
            return {
                'n_classes': 0,
                'total_samples': 0,
                'class_counts': {},
                'min_per_class': 0,
                'balanced': False
            }