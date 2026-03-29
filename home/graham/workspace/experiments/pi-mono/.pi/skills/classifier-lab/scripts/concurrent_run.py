def phase_data_validation(data_dir, modality):
    """Validate dataset and return audit information."""
    audit = {}
    
    # Check if data_dir is a local path that exists
    if os.path.exists(data_dir):
        # Existing local path handling logic
        if modality == 'text':
            # Handle text data from local directory
            class_dirs = [d for d in os.listdir(data_dir) if os.path.isdir(os.path.join(data_dir, d))]
            n_classes = len(class_dirs)
            total_samples = 0
            class_counts = {}
            min_per_class = float('inf')
            
            for class_dir in class_dirs:
                class_path = os.path.join(data_dir, class_dir)
                samples = [f for f in os.listdir(class_path) if os.path.isfile(os.path.join(class_path, f))]
                class_counts[class_dir] = len(samples)
                total_samples += len(samples)
                if len(samples) < min_per_class:
                    min_per_class = len(samples)
            
            balanced = all(count == class_counts[class_dirs[0]] for count in class_counts.values())
            
            audit.update({
                'n_classes': n_classes,
                'total_samples': total_samples,
                'class_counts': class_counts,
                'min_per_class': min_per_class,
                'balanced': balanced
            })
        else:
            # Handle other modalities from local directory
            audit.update({
                'n_classes': 0,
                'total_samples': 0,
                'class_counts': {},
                'min_per_class': 0,
                'balanced': False
            })
    else:
        # Handle HuggingFace dataset names
        from datasets import load_dataset
        try:
            ds = load_dataset(data_dir, split='train[:100]')
            class_names = ds.features['label'].names
            n_classes = len(class_names)
            total_samples = len(ds)
            
            class_counts = {}
            for label in ds['label']:
                class_name = class_names[label]
                class_counts[class_name] = class_counts.get(class_name, 0) + 1
            
            min_per_class = min(class_counts.values())
            balanced = all(count == min_per_class for count in class_counts.values())
            
            audit.update({
                'n_classes': n_classes,
                'total_samples': total_samples,
                'class_counts': class_counts,
                'min_per_class': min_per_class,
                'balanced': balanced
            })
        except Exception as e:
            audit.update({
                'n_classes': 0,
                'total_samples': 0,
                'class_counts': {},
                'min_per_class': 0,
                'balanced': False,
                'error': str(e)
            })
    
    return audit